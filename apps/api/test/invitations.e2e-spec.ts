/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'http';
import { AppModule } from './../src/app.module';
import { SystemAdminGuard } from './../src/modules/auth/system-admin.guard';
import { EmailService } from './../src/modules/email/email.service.abstract';
import { eq } from 'drizzle-orm';

describe('Invitation Flow (e2e)', () => {
  let app: INestApplication;
  let lastEmail: any = null;
  let invitationId: string;
  const testEmail = `invite-test-${Date.now()}@example.com`;

  // Mock Email Service to intercept the invite link
  const mockEmailService = {
    sendEmail: jest.fn().mockImplementation(async (payload) => {
      lastEmail = payload;
      return Promise.resolve();
    }),
  };

  beforeAll(async () => {
    process.env.BETTER_AUTH_URL = 'http://localhost:3000/api';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.BETTER_AUTH_SECRET =
      'test-secret-12345678901234567890123456789012'; // Must be long enough

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(SystemAdminGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(EmailService)
      .useValue(mockEmailService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Seed the DB with the 'mock-user-id' that the Mock Identity Provider returns
    // This is necessary because 'createSystemInvitation' inserts into the REAL DB using this ID,
    // so the Foreign Key constraint on 'inviterId' must be satisfied.
    const db = app.get('DRIZZLE_DB');
    // We import schema dynamically or use raw query if schema import is tricky in E2E
    // But we can try using the schema from the source
    const schema = require('./../src/db/schema');

    // Cleanup dependencies first to avoid foreign key constraints
    await db
      .delete(schema.invitation)
      .where(eq(schema.invitation.inviterId, 'mock-user-id'));
    await db
      .delete(schema.session)
      .where(eq(schema.session.userId, 'mock-user-id'));
    await db
      .delete(schema.account)
      .where(eq(schema.account.userId, 'mock-user-id'));
    await db
      .delete(schema.member)
      .where(eq(schema.member.userId, 'mock-user-id'));

    // Finally delete the user
    await db.delete(schema.user).where(eq(schema.user.id, 'mock-user-id'));

    await db.insert(schema.user).values({
      id: 'mock-user-id',
      name: 'Admin User',
      email: 'admin@nexiom.com',
      systemRole: 'platform_admin',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    // Ideally clean up the user created
    await app.close();
  });

  it('should create a system invitation', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/admin/invitations')
      .send({
        email: testEmail,
        role: 'admin',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.email).toBe(testEmail);
    invitationId = response.body.id;

    // Verify email was "sent"
    expect(mockEmailService.sendEmail).toHaveBeenCalled();
    expect(lastEmail.to).toBe(testEmail);
    expect(lastEmail.text).toContain('/invite/accept?id=');
  });

  it('should allow a new user to sign up via the invitation', async () => {
    // Simulate the "AcceptInvitePage" -> "SignupPage" flow
    // In the real app, the user lands on /invite/accept, redirects to /signup, and then POSTs to /auth/complete-invite

    const signupPayload = {
      firstName: 'Invited',
      lastName: 'User',
      email: testEmail,
      password: 'password123',
      invitationId: invitationId,
    };

    const response = await request(app.getHttpServer() as Server)
      .post('/auth/complete-invite')
      .send(signupPayload)
      .expect(201);

    // Expect a session and user object
    expect(response.body).toHaveProperty('session');
    expect(response.body).toHaveProperty('user');
    expect(response.body.user.email).toBe(testEmail);
    expect(response.body.user.emailVerified).toBe(true); // Should be auto-verified
  });

  it('should allow the invited user to login subsequently', async () => {
    const loginPayload = {
      email: testEmail,
      password: 'password123',
    };

    const response = await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send(loginPayload)
      .expect(201);

    expect(response.body).toHaveProperty('token'); // Session Token
    expect(response.body.user.email).toBe(testEmail);
  });
});
