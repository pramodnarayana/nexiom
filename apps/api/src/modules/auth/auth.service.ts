import { Inject, Injectable } from '@nestjs/common'; // Removed UnauthorizedException
import {
  AUTH_PROVIDER,
  IAuthProvider,
  LoginCredentials,
  AuthResult,
  Session,
  User,
  CreateUserInput,
} from '@nexiom/identity';
import { TenantsService } from '../tenants/tenants.service';

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
      user: result.user,
    };
  }

  async getEnrichedSession(token: string): Promise<{
    session: Session;
    user: User & { organizationId?: string; hasTenant: boolean };
  } | null> {
    const validSession = await this.authProvider.validateSession(token);
    if (!validSession) return null;

    const { session, user } = validSession;

    // Enrichment: Check if user has a tenant
    const tenants = await this.tenantsService.findAllForUser(user.id);
    // Deterministic selection: Sort by creation date (newest first)
    // using slice() to avoid mutating the original array
    const sortedTenants = tenants
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const hasTenant = sortedTenants.length > 0;
    const organizationId = hasTenant ? sortedTenants[0].id : undefined;

    return {
      session: {
        ...session,
      },
      user: {
        ...user,
        organizationId,
        hasTenant,
      },
    };
  }

  getHandler() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const handler = (this.authProvider as any).getHandler;
    if (typeof handler !== 'function') {
      throw new TypeError('Auth Provider does not support getHandler');
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return handler.call(this.authProvider);
  }

  // Delegated methods

  async createUser(input: CreateUserInput) {
    return this.authProvider.createUser(input);
  }

  async setPassword(userId: string, password: string) {
    if (this.authProvider.setPassword) {
      return this.authProvider.setPassword(userId, password);
    }
    throw new Error('Auth Provider does not support setting password');
  }
}
