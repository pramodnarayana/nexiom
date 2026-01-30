import { Inject, Injectable, Logger } from '@nestjs/common'; // Removed UnauthorizedException
import {
  AUTH_PROVIDER,
  IAuthProvider,
  LoginCredentials,
  AuthResult,
  Session,
  User,
  CreateUserInput,
  TENANT_PROVIDER,
  ITenantProvider,
  PERMISSION_PROVIDER,
  IPermissionProvider,
} from '@nexiom/identity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_PROVIDER) private readonly authProvider: IAuthProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
    @Inject(PERMISSION_PROVIDER)
    private readonly permissionProvider: IPermissionProvider,
  ) {}

  async login(credentials: LoginCredentials): Promise<AuthResult> {
    const result = await this.authProvider.login(credentials);

    // Enrich with permissions immediately so frontend can perform PBAC
    let enriched = null;
    try {
      enriched = await this.getEnrichedSession(result.session.token);
    } catch (error) {
      this.logger.error('Failed to enrich session during login', error);
      // Fallback to basic result
      return result;
    }

    if (!enriched) {
      // Should not happen if login succeeded, but fallback to basic result
      return result;
    }

    return {
      ...result,
      user: {
        ...result.user,
        ...enriched.user, // Overwrite with enriched user (contains permissions)
      },
    };
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
    user: User & {
      organizationId?: string;
      hasTenant: boolean;
      permissions: string[];
    };
  } | null> {
    const validSession = await this.authProvider.validateSession(token);
    if (!validSession) return null;

    const { session, user } = validSession;

    // Enrichment: Check if user has a tenant
    const tenants = await this.tenantProvider.findAllForUser(user.id);
    // Deterministic selection: Sort by creation date (newest first)
    // using slice() to avoid mutating the original array
    const sortedTenants = tenants
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const hasTenant = sortedTenants.length > 0;
    const organizationId = hasTenant ? sortedTenants[0].id : undefined;

    // Fetch Permissions
    // If we have an organization context, fetch permissions for that tenant
    // Otherwise fetch system permissions (if any, e.g. system admin)
    const permissions: string[] = [];
    try {
      // 1. Platform Admin always gets wildcard (Global Access)
      if (user.systemRole === 'platform_admin') {
        permissions.push('*');
      } else if (user.systemRole === 'platform_user') {
        // Platform Users get access to the admin dashboard (but not everything)
        permissions.push('admin_dashboard:view');
      }

      // 2. Add Tenant-specific permissions if context exists
      if (organizationId) {
        const perms = await this.permissionProvider.getPermissions(
          user,
          organizationId,
        );
        permissions.push(...perms);
      }
    } catch (error) {
      this.logger.error(
        `Failed to fetch permissions for user ${user.id} in org ${organizationId}`,
        error,
      );
      // Fallback: If platform admin, ensure they still have access
      if (user.systemRole === 'platform_admin') {
        permissions.push('*');
      } else if (user.systemRole === 'platform_user') {
        permissions.push('admin_dashboard:view');
      }
    }

    return {
      session: {
        ...session,
      },
      user: {
        ...user,
        organizationId,
        hasTenant,
        permissions,
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
