import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUser } from './users.schema';

/**
 * Controller for handling User Management HTTP requests.
 * Exposes endpoints for creating and listing users.
 */
@Controller('users')
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
    findAll() {
        return this.usersService.findAll();
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
