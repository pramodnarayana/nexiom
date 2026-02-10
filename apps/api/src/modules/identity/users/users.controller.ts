import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Inject,
  UseGuards,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Delete,
  Logger,
} from '@nestjs/common';
import {
  USER_PROVIDER,
  IUserProvider,
  TENANT_PROVIDER,
  ITenantProvider,
  User,
} from '@nexiom/identity';
import { InvitationsService } from '../invitations/invitations.service';
import { CreateUser } from './users.validation';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';

// Union type to support both real Users and Pending Invitations in the same list
export type UserListItem =
  | (User & { kind?: 'user' }) // Optional discriminator for backwards compat if needed, or strict: { kind: 'user' }
  | {
      kind: 'invitation';
      id: string;
      email: string;
      name: string;
      role: string;
      status: 'pending';
      emailVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
      isInvitation: true;
      // Optional fields from User to satisfy strict typing if needed by consumers
      permissions?: string[];
      image?: string;
      banned?: boolean;
      banReason?: string | null;
      banExpires?: Date | null;
    };

export interface UserListResponse {
  data: UserListItem[];
  total: number;
}

/**
 * Controller for handling User Management HTTP requests.
 * Exposes endpoints for creating and listing users.
 * Protected by AuthGuard to ensure only authenticated users can access.
 */
@Controller('users')
@UseGuards(AuthGuard, PermissionsGuard)
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    @Inject(USER_PROVIDER) private readonly userProvider: IUserProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
    private readonly invitationsService: InvitationsService,
  ) {}

  /**
   * Endpoint to get the current user's profile with full permissions.
   * Useful for frontend hydration when standard auth response is sanitized.
   */
  @Get('me')
  async getMe(@Req() req: Request & { user: { id: string } }) {
    this.logger.debug(`getMe called for user: ${req.user?.id}`);
    // AuthGuard ensures req.user is populated
    const user = await this.userProvider.findById(req.user.id);
    if (!user) {
      this.logger.warn(`User not found for ID: ${req.user.id}`);
      throw new NotFoundException('User not found');
    }
    this.logger.debug(`Returning user profile for: ${req.user.id}`);
    return user;
  }

  /**
   * Endpoint to create a new user directly (Admin only).
   */
  @Post()
  @RequirePermission('users', 'manage')
  create(@Body() createUser: CreateUser) {
    return this.userProvider.create(createUser);
  }

  /**
   * Endpoint to list all users.
   *
   * @returns List of users.
   */
  @Get()
  @RequirePermission('users', 'read')
  async findAll(
    @Req() req: Request & { user: { organizationId?: string } },
  ): Promise<UserListResponse> {
    // AuthGuard guarantees session is valid and populates user info
    // We use 'organizationId' (mapped in getSessionWithOrg)
    const tenantId = req.user?.organizationId;

    if (!tenantId) {
      // STRICT ISOLATION: Admin users must belong to an organization to see users.
      // Returning empty list is safer than throwing error for UI handling,
      // but for security transparency, let's return empty.
      return { data: [], total: 0 };
    }

    const { data: users, total: userTotal } = await this.userProvider.findAll({
      tenantId,
    });
    const invitations = await this.invitationsService.list(tenantId);

    // Filter out invitations for users that already exist
    const existingEmails = new Set(users.map((u) => u.email.toLowerCase()));
    const pendingInvitations = invitations.filter(
      (inv) => !existingEmails.has(inv.email.toLowerCase()),
    );

    // Map invitations to User structure for unified UI list
    const invitedUsers: UserListItem[] = pendingInvitations.map((inv) => ({
      id: inv.id, // Use invitation ID temporarily
      email: inv.email,
      name: '', // Name might not be known yet
      role: inv.role,
      status: 'pending', // Explicit status for UI (vs 'active')
      emailVerified: false,
      createdAt: inv.createdAt,
      updatedAt: inv.createdAt,
      isInvitation: true,
      // Ensure other fields are undefined or compatible
      permissions: undefined,
      image: undefined,
      banned: false,
    }));

    // Merge: Users first, then Pending Invites (or sort by date)
    const combinedData = [...users, ...invitedUsers];

    // Return Refine-compatible pagination structure
    return {
      data: combinedData,
      total: userTotal + invitations.length,
    };
  }

  /**
   * Endpoint to get a single user by ID.
   *
   * @param id - The ID from the URL path.
   * @returns The user object.
   */
  @Get(':id')
  @RequirePermission('users', 'read')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: { organizationId?: string } },
  ) {
    const tenantId = req.user?.organizationId;

    // Strict isolation: Admin users must belong to a tenant to view details
    if (!tenantId) {
      throw new NotFoundException('User not found'); // Mask existence
    }

    const user = await this.userProvider.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Tenant Scoping check
    // Ensure the target user is a member of the requester's tenant
    const userTenants = await this.tenantProvider.findAllForUser(user.id);
    const isMember = userTenants.some((t) => t.id === tenantId);

    if (!isMember) {
      throw new NotFoundException('User not found'); // Mask existence for security
    }

    return user;
  }

  /**
   * Endpoint to remove a user from the organization.
   * If strictly 1:1, this effectively acts as a delete.
   */
  @Delete(':id')
  @RequirePermission('users', 'manage')
  async remove(
    @Param('id') id: string,
    @Req() req: Request & { user: { id: string; organizationId?: string } },
  ) {
    const tenantId = req.user?.organizationId;
    if (!tenantId) {
      throw new BadRequestException('Organization context required');
    }

    // SECURITY: Prevent self-deletion
    // This is a critical enterprise-grade guard.
    if (id === req.user.id) {
      throw new BadRequestException('You cannot delete your own account.');
    }

    try {
      // Use atomic operation to prevent TOCTOU race condition
      // This combines membership verification, last-admin check, and deletion in a single transaction
      const result = await this.userProvider.deleteIfNotLastAdmin(id, tenantId);

      if (!result.success) {
        throw new BadRequestException(
          'Cannot delete the last admin of the organization',
        );
      }

      return { success: true, hardDeleted: result.hardDeleted };
    } catch (error) {
      // Translate provider-specific errors to HTTP exceptions
      if (
        error instanceof Error &&
        error.message.includes('not a member of this organization')
      ) {
        throw new NotFoundException('User not found in this organization');
      }

      // Re-throw BadRequestException (last admin case)
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle unexpected errors
      // Log full details for debugging (in real app utilize a logger)
      const err = error as Error;
      this.logger.error(`User deletion failed: ${err.message}`, err.stack);

      // Return generic message to client to avoid leaking internals
      throw new InternalServerErrorException('Failed to delete user');
    }
  }
}
