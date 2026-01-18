/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { SystemAdminGuard } from './../src/modules/auth/system-admin.guard';

describe('SystemAdminController (e2e)', () => {
  let app: INestApplication;

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
    await app.close();
  });

  // Test Flow variables
  let createdTenantId: string;
  const testSlug = `e2e-test-tenant-${Date.now()}`;

  it('should create a tenant', async () => {
    const response = await request(app.getHttpServer())
      .post('/admin/tenants')
      .send({
        name: 'E2E Test Tenant',
        slug: testSlug,
        logo: 'https://example.com/logo.png',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.slug).toBe(testSlug);
    createdTenantId = response.body.id;
  });

  it('should list tenants and find the created one', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/tenants')
      .expect(200);

    const tenants = response.body.data;
    const found = tenants.find((t: any) => t.id === createdTenantId);
    expect(found).toBeDefined();
    expect(found.slug).toBe(testSlug);
  });

  it('should update the tenant', async () => {
    const newName = 'E2E Tenant Updated';
    const response = await request(app.getHttpServer())
      .patch(`/admin/tenants/${createdTenantId}`)
      .send({
        name: newName,
        status: 'suspended',
      })
      .expect(200);

    expect(response.body.name).toBe(newName);
    expect(response.body.status).toBe('suspended');
  });

  it('should delete the tenant', async () => {
    await request(app.getHttpServer())
      .delete(`/admin/tenants/${createdTenantId}`)
      .expect(200);
  });

  it('should verify the tenant is gone', async () => {
    // Checking list again to ensure it's gone
    const response = await request(app.getHttpServer())
      .get('/admin/tenants')
      .expect(200);

    const tenants = response.body.data;
    const found = tenants.find((t: any) => t.id === createdTenantId);
    expect(found).toBeUndefined();
  });
});
