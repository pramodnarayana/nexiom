import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Zod Schema to validate the Create User Request.
 * Enforces email format and allowed roles.
 */
export const CreateUserSchema = z.object({
    email: z.string().email({ message: 'Invalid email address' }),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.enum(['admin', 'editor', 'viewer'], {
        message: 'Role must be admin, editor, or viewer',
    }),
});

/**
 * DTO class generated from the Zod Schema.
 * Used by NestJS for type inference and validation pipes.
 */
export class CreateUser extends createZodDto(CreateUserSchema) { }
