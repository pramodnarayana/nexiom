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
  Delete,
} from '@nestjs/common';
import {
  USER_PROVIDER,
  IUserProvider,
  TENANT_PROVIDER,
  ITenantProvider,
} from '@nexiom/identity';
import { CreateUser } from './users.validation';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/require-permission.decorator';

/**
 * Controller for handling User Management HTTP requests.
 * Exposes endpoints for creating and listing users.
 * Protected by AuthGuard to ensure only authenticated users can access.
 */
@Controller('users')
@UseGuards(AuthGuard, PermissionsGuard)
export class UsersController {
  constructor(
    @Inject(USER_PROVIDER) private readonly userProvider: IUserProvider,
    @Inject(TENANT_PROVIDER) private readonly tenantProvider: ITenantProvider,
  ) {}

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
  async findAll(@Req() req: Request & { user: { organizationId?: string } }) {
    // AuthGuard guarantees session is valid and populates user info
    // We use 'organizationId' (mapped in getSessionWithOrg)
    const tenantId = req.user?.organizationId;

    if (!tenantId) {
      // STRICT ISOLATION: Admin users must belong to an organization to see users.
      // Returning empty list is safer than throwing error for UI handling,
      // but for security transparency, let's return empty.
      return [];
    }

    const result = await this.userProvider.findAll({ tenantId });
    return result;
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
      const deleted = await this.userProvider.deleteIfNotLastAdmin(
        id,
        tenantId,
      );

      if (!deleted) {
        throw new BadRequestException(
          'Cannot delete the last admin of the organization',
        );
      }

      return { success: true };
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
      console.error('User deletion failed:', error);

      // Return generic message to client to avoid leaking internals
      throw new BadRequestException('Failed to delete user');
    }
  }
}
