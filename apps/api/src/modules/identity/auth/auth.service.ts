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
import { getRequiredSystemTenantId } from '../../../constants';

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
      organizationName?: string;
      organizationSlug?: string;
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
    const organizationName = hasTenant
      ? (sortedTenants[0].name ?? undefined)
      : undefined;
    const organizationSlug = hasTenant
      ? (sortedTenants[0].slug ?? undefined)
      : undefined;

    // Fetch Permissions
    // If we have an organization context, fetch permissions for that tenant
    // Otherwise fetch system permissions (if any, e.g. system admin)
    // Fetch Permissions
    // 1. Fetch System Permissions (Global)
    const permissionsSet = new Set<string>();
    try {
      const systemPerms = await this.permissionProvider.getPermissions(
        user,
        getRequiredSystemTenantId(),
      );
      for (const p of systemPerms) {
        permissionsSet.add(p);
      }
    } catch (_error) {
      // Expected: Most users won't have system-level permissions
      this.logger.debug(`No system permissions for user ${user.id}`);
    }

    // 2. Fetch Tenant-specific permissions if context exists
    if (organizationId) {
      try {
        const tenantPerms = await this.permissionProvider.getPermissions(
          user,
          organizationId,
        );
        for (const p of tenantPerms) {
          permissionsSet.add(p);
        }
      } catch (error) {
        this.logger.error(
          `Failed to fetch permissions for user ${user.id} in org ${organizationId}`,
          error,
        );
      }
    }

    const permissions = Array.from(permissionsSet);

    return {
      session: {
        ...session,
      },
      user: {
        ...user,
        organizationId,
        organizationName,
        organizationSlug,
        hasTenant,
        permissions,
      },
    };
  }

  async hasSystemPermission(user: User, action: string): Promise<boolean> {
    try {
      const perms = await this.permissionProvider.getPermissions(
        user,
        getRequiredSystemTenantId(),
      );
      // 'manage' implies full access, 'view' implies read access.
      // We check if the user has specific permission OR wildcard.
      if (perms.includes('*')) return true;
      if (perms.includes(`system:${action}`)) return true;

      // Legacy mapping (temporarily support old roles via permission check if needed,
      // but we are moving to pure DB, so strict check is better).
      return false;
    } catch (error) {
      this.logger.warn(
        `Failed to check system permission for user ${user.id}`,
        error,
      );
      return false;
    }
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
    const user = await this.authProvider.createUser(input);

    // Auto-provision tenant with fancy name + admin role
    try {
      await this.tenantProvider.provisionTenantForUser(user.id);
    } catch (error) {
      this.logger.error(
        `Failed to auto-provision tenant for user ${user.id}`,
        error,
      );
      // We don't fail the signup if tenant provisioning fails,
      // but we should probably alert or retry.
      // For now, logging effectively "swallows" the error but preserves the user account.
      // Ideally, transaction should be used, but AuthProvider is separate.
    }

    return user;
  }

  async setPassword(userId: string, password: string) {
    if (this.authProvider.setPassword) {
      return this.authProvider.setPassword(userId, password);
    }
    throw new Error('Auth Provider does not support setting password');
  }

  /**
   * Resend verification email for a user
   * @param email User's email address
   */
  async resendVerificationEmail(email: string): Promise<void> {
    if (this.authProvider.resendVerificationEmail) {
      return this.authProvider.resendVerificationEmail(email);
    }
    throw new Error(
      'Auth Provider does not support resending verification email',
    );
  }
}
