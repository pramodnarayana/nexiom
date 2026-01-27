import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { USER_PROVIDER, IUserProvider } from '@nexiom/identity';
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
  ) {}

  /**
   * Endpoint to create a new user.
   * The Body is automatically validated against the Zod Schema.
   *
   * @param createUser - The validated request body.
   * @returns The created user.
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
  findOne(@Param('id') id: string) {
    return this.userProvider.findById(id);
  }
}
