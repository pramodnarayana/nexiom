// Set Env Vars before imports if possible or at very top
process.env.BETTER_AUTH_URL = 'http://localhost:3000/api/auth';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET = 'test-secret-12345678901234567890123456789012';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'node:http';
import { AppModule } from './../src/app/app.module.js';
import { SystemAdminGuard } from './../src/modules/identity/auth/system-admin.guard.js';
import { EmailService } from './../src/modules/email/email.service.abstract.js';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { vi } from 'vitest';

import * as schema from './../src/db/schema.js';

describe('Invitation Flow (e2e)', () => {
  let app: INestApplication;
  let lastEmail: Record<string, unknown> | null = null;
  let invitationId: string;
  const testEmail = `invite-test-${Date.now()}@example.com`;

  // Mock Email Service to intercept the invite link
  const mockEmailService = {
    sendEmail: vi
      .fn()
      .mockImplementation(async (payload: Record<string, unknown>) => {
        lastEmail = payload;
        return Promise.resolve();
      }),
  };

  beforeAll(async () => {
    // Env vars set at top of file
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
    const db = app.get<NodePgDatabase<typeof schema>>('DRIZZLE_DB');

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
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    try {
      // Clean up the user and invitation created during the test
      const db = app.get<NodePgDatabase<typeof schema>>('DRIZZLE_DB');

      // 1. Find the user first
      const testUser = await db.query.user.findFirst({
        where: eq(schema.user.email, testEmail),
      });

      if (testUser) {
        // 2. Find any organizations this user belongs to (potential artifacts)
        const memberships = await db
          .select()
          .from(schema.member)
          .where(eq(schema.member.userId, testUser.id));

        const orgIds = memberships
          .map((m) => m.organizationId)
          .filter((id): id is string => id !== null);

        // 3. Delete Memberships first (Foreign Key Constraint: Restrict)
        await db
          .delete(schema.member)
          .where(eq(schema.member.userId, testUser.id));

        // 4. Delete Organizations (if any were created)
        // Note: In a real app, we might check if they are the *only* member, but for this test user, they would be.
        for (const orgId of orgIds) {
          await db
            .delete(schema.organization)
            .where(eq(schema.organization.id, orgId));
        }

        // 5. Delete Session & Account (Auth)
        await db
          .delete(schema.session)
          .where(eq(schema.session.userId, testUser.id));
        await db
          .delete(schema.account)
          .where(eq(schema.account.userId, testUser.id));

        // 6. Finally delete the user
        await db.delete(schema.user).where(eq(schema.user.id, testUser.id));
      }

      // Delete the invitation if it still exists (though usually consumed)
      if (invitationId) {
        await db
          .delete(schema.invitation)
          .where(eq(schema.invitation.id, invitationId));
      }
    } catch (e) {
      console.warn('E2E Cleanup: Failed to delete test resources', e);
    } finally {
      await app.close();
    }
  });

  it('should create a system invitation', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/admin/invitations')
      .send({
        email: testEmail,
        role: 'platform_admin',
      })
      .expect(201);

    const body = response.body as { id: string; email: string };
    expect(body).toHaveProperty('id');
    expect(body.email).toBe(testEmail);
    invitationId = body.id;

    // Verify email was "sent"
    expect(mockEmailService.sendEmail).toHaveBeenCalled();
    expect(lastEmail).not.toBeNull();
    expect(lastEmail!.to).toBe(testEmail);
    expect(lastEmail!.text).toContain('/invite/accept?id=');
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
    const body = response.body as {
      user: { id: string; email: string; emailVerified: boolean };
      session: unknown;
    };
    expect(body).toHaveProperty('session');
    expect(body).toHaveProperty('user');
    expect(body.user.email).toBe(testEmail);
    expect(body.user.emailVerified).toBe(true); // Should be auto-verified

    // VERIFICATION: Ensure NO Organization was created contextually
    // This is the critical check for the "Unwanted Tenant Creation" bug
    const db = app.get<NodePgDatabase<typeof schema>>('DRIZZLE_DB');
    const userOrgs = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, body.user.id)); // Cast if type is loose in test

    expect(userOrgs.length).toBe(0); // Should have 0 memberships for a Platform Admin invite
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

    const body = response.body as {
      session: { token: string };
      user: { email: string };
    };
    expect(body).toHaveProperty('session');
    expect(body.session).toHaveProperty('token'); // Session Token
    expect(body.user.email).toBe(testEmail);
  });
});
