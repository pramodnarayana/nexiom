import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Delete,
  Logger,
} from '@nestjs/common';
import {
  ListUsersWithInvitationsUseCase,
  RemoveUserUseCase,
  GetUserProfileUseCase,
  CreateUserUseCase,
  GetUserByIdUseCase,
} from '@soopa/identity';
import type { UserListItem } from '@soopa/identity';
import { CreateUser } from './users.validation.js';
import { Request } from 'express';
import { AuthGuard, PermissionsGuard, RequirePermission } from '@soopa/auth';

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
    private readonly listUsersWithInvitationsUseCase: ListUsersWithInvitationsUseCase,
    private readonly removeUserUseCase: RemoveUserUseCase,
    private readonly getUserProfileUseCase: GetUserProfileUseCase,
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
  ) {}

  /**
   * Endpoint to get the current user's profile with full permissions.
   * Useful for frontend hydration when standard auth response is sanitized.
   */
  @Get('me')
  async getMe(@Req() req: Request & { user: { id: string } }) {
    this.logger.debug(`getMe called for user: ${req.user?.id}`);
    // AuthGuard ensures req.user is populated
    return this.getUserProfileUseCase.execute(req.user.id);
  }

  /**
   * Endpoint to create a new user directly (Admin only).
   */
  @Post()
  @RequirePermission('users', 'manage')
  create(@Body() createUser: CreateUser) {
    return this.createUserUseCase.execute(createUser);
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
    const tenantId = req.user?.organizationId;
    if (!tenantId) {
      return { data: [], total: 0 };
    }
    return this.listUsersWithInvitationsUseCase.execute(tenantId);
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
    return this.getUserByIdUseCase.execute(id, tenantId);
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

    try {
      return await this.removeUserUseCase.execute(id, req.user.id, tenantId);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      const err = error as Error;
      this.logger.error(`User deletion failed: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to delete user');
    }
  }
}
