import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'http';
import { AppModule } from './../src/app.module';
import { SystemAdminGuard } from './../src/modules/auth/system-admin.guard';

interface TenantResponse {
  id: string;
  name: string;
  slug: string;
  status: string;
  [key: string]: unknown;
}

interface TenantListResponse {
  data: TenantResponse[];
  total: number;
}

describe('SystemAdminController (e2e)', () => {
  let app: INestApplication;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    // Cleanup any lingering tenants
    for (const id of createdTenantIds) {
      await request(app.getHttpServer() as Server).delete(
        `/admin/tenants/${id}`,
      );
    }
    await app.close();
  });

  const createTestTenant = async (slugSuffix: string) => {
    const testSlug = `e2e-test-${slugSuffix}-${Date.now()}`;
    const response = await request(app.getHttpServer() as Server)
      .post('/admin/tenants')
      .send({
        name: `E2E Test ${slugSuffix}`,
        slug: testSlug,
        logo: 'https://example.com/logo.png',
      })
      .expect(201);

    const body = response.body as TenantResponse;
    createdTenantIds.push(body.id);
    return { ...body, testSlug };
  };

  it('should create a tenant', async () => {
    const testSlug = `e2e-create-${Date.now()}`;
    const response = await request(app.getHttpServer() as Server)
      .post('/admin/tenants')
      .send({
        name: 'E2E Create Test',
        slug: testSlug,
        logo: 'https://example.com/logo.png',
      })
      .expect(201);

    const body = response.body as TenantResponse;
    expect(body).toHaveProperty('id');
    expect(body.slug).toBe(testSlug);
    createdTenantIds.push(body.id);
  });

  it('should list tenants and find the created one', async () => {
    const { id, testSlug } = await createTestTenant('list');

    const response = await request(app.getHttpServer() as Server)
      .get('/admin/tenants')
      .expect(200);

    const body = response.body as TenantListResponse;
    const tenants = body.data;
    const found = tenants.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.slug).toBe(testSlug);
  });

  it('should update the tenant', async () => {
    const { id } = await createTestTenant('update');
    const newName = 'E2E Tenant Updated';

    const response = await request(app.getHttpServer() as Server)
      .patch(`/admin/tenants/${id}`)
      .send({
        name: newName,
        status: 'suspended',
      })
      .expect(200);

    const body = response.body as TenantResponse;
    expect(body.name).toBe(newName);
    expect(body.status).toBe('suspended');
  });

  it('should delete the tenant', async () => {
    const { id } = await createTestTenant('delete');

    await request(app.getHttpServer() as Server)
      .delete(`/admin/tenants/${id}`)
      .expect(200);

    // Verify gone
    const response = await request(app.getHttpServer() as Server)
      .get('/admin/tenants')
      .expect(200);

    const body = response.body as TenantListResponse;
    const found = body.data.find((t) => t.id === id);
    expect(found).toBeUndefined();

    // Remove from cleanup list as it's already deleted
    const index = createdTenantIds.indexOf(id);
    if (index > -1) createdTenantIds.splice(index, 1);
  });
});
