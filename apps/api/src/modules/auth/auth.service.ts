import { Inject, Injectable } from '@nestjs/common'; // Removed UnauthorizedException
import {
  AUTH_PROVIDER,
  IAuthProvider,
  LoginCredentials,
  AuthResult,
  // Removed unused imports
} from '@nexiom/identity';
import { TenantsService } from '../tenants/tenants.service';
// Removed unused CreateUser import

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
    private readonly tenantsService: TenantsService,
  ) {}

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    return this.authProvider.login(credentials);
  }

  async getSessionFromHeaders(headers: Headers) {
    const result = await this.authProvider.getSessionFromHeaders(headers);
    if (!result) return null;
    return {
      session: result.session,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      user: result.user, // Cast to any then User in consumers or improving interface later
    };
  }

  async getEnrichedSession(token: string): Promise<{
    session: any; // Ideally stricter Session type
    user: any; // Ideally stricter User type
  } | null> {
    const validSession = await this.authProvider.validateSession(token);
    if (!validSession) return null;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { session, user } = validSession;

    // Enrichment: Check if user has a tenant
    const tenants = await this.tenantsService.findAllForUser(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
      user.id,
    );
    const hasTenant = tenants.length > 0;
    const organizationId = hasTenant ? tenants[0].id : undefined;

    return {
      session: {
        ...session,
        // Add enriched properties if needed by Guards/Decorators
      },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      user: {
        ...user,
        organizationId,
        hasTenant,
      },
    };
  }

  getHandler() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this.authProvider as any).getHandler();
  }

  // Delegated methods

  async createUser(input: any) {
    // Type strictly later
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return this.authProvider.createUser(input);
  }

  async setPassword(userId: string, password: string) {
    if (this.authProvider.setPassword) {
      return this.authProvider.setPassword(userId, password);
    }
    throw new Error('Auth Provider does not support setting password');
  }
}
