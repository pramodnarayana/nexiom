/* eslint-disable */
// Basic mock to prevent crashes
export const toNodeHandler = (_handler: unknown) => {
  return (_req: unknown, _res: unknown) => { };
};

// Mock betterAuth to return an object with 'api'
export const betterAuth = (_options: unknown) => {
  return {
    api: {
      signUpEmail: async (opts: any) => {
        // Mock response mirroring what BetterAuth returns
        return {
          user: {
            id: 'mock-user-id',
            email: opts.body.email,
            name: opts.body.name,
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          session: {
            token: 'mock-session-token',
            userId: 'mock-user-id',
            // expires in future
            expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          },
        };
      },
      signInEmail: async (opts: any) => {
        const userStub = {
          id: 'mock-user-id',
          email: opts.body.email,
          name: 'Mock User',
          emailVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const sessionStub = {
          token: 'mock-session-token',
          userId: userStub.id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        };

        return {
          ok: true,
          statusText: 'OK',
          headers: {
            get: (key: string) =>
              key.toLowerCase() === 'set-cookie' ? 'mock-cookie=123' : null,
            getSetCookie: () => ['mock-cookie=123'],
          },
          json: async () => ({
            token: sessionStub.token,
            user: userStub,
            session: sessionStub,
          }),
        };
      },
      createInvitation: async (opts: any) => {
        return {
          id: 'mock-invitation-id',
          email: opts.body.email,
          role: opts.body.role,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 48), // 48h
          organizationId: opts.body.organizationId,
        };
      },
      getInvitation: async (opts: any) => {
        return {
          id: opts.query.id,
          email: 'test@example.com', // fallback
          role: 'user',
          status: 'pending',
          organizationId: 'mock-org-id',
        };
      },
      acceptInvitation: async (_opts: any) => {
        return {
          invitation: { status: 'accepted' },
          member: { userId: 'mock-user-id', organizationId: 'mock-org-id' },
        };
      },
      getSession: async (_opts: any) => {
        return {
          session: {
            token: 'mock-session-token',
            userId: 'mock-user-id',
            expiresAt: new Date(Date.now() + 1000 * 60 * 60),
          },
          user: {
            id: 'mock-user-id',
            email: 'admin@nexiom.com', // default mocking admin for simplicity
            name: 'Admin User',
            role: 'admin',
          },
        };
      },
    },
    handler: (_req: any, _res: any) => { },
  };
};

export const drizzleAdapter = (_db: unknown, _options: unknown) => {
  return {};
};

export const organization = (_options: unknown) => {
  return {};
};

export const admin = (_options: unknown) => {
  return {};
};
