import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUser } from './users.schema';
import { Request } from 'express';
import { AuthGuard } from '../auth.guard';

/**
 * Controller for handling User Management HTTP requests.
 * Exposes endpoints for creating and listing users.
 * Protected by AuthGuard to ensure only authenticated users can access.
 */
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    /**
     * Endpoint to create a new user.
     * The Body is automatically validated against the Zod Schema.
     * 
     * @param createUser - The validated request body.
     * @returns The created user.
     */
    @Post()
    create(@Body() createUser: CreateUser) {
        return this.usersService.create(createUser);
    }

    /**
     * Endpoint to list all users.
     * 
     * @returns List of users.
     */
    @Get()
    findAll(@Req() req: Request & { user: { organizationId?: string } }) {
        // AuthGuard guarantees session is valid and populates user info
        // We use 'organizationId' (mapped in getSessionWithOrg)
        const tenantId = req.user?.organizationId;

        console.log(`[UsersController] Listing users for Tenant: ${tenantId}`);

        if (!tenantId) {
            // STRICT ISOLATION: Admin users must belong to an organization to see users.
            // Returning empty list is safer than throwing error for UI handling, 
            // but for security transparency, let's return empty.
            return [];
        }

        return this.usersService.findAll(tenantId);
    }

    /**
     * Endpoint to get a single user by ID.
     * 
     * @param id - The ID from the URL path.
     * @returns The user object.
     */
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }
}
