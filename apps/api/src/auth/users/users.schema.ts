import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Zod Schema to validate the Create User Request.
 * Enforces email format and allowed roles.
 */
export const CreateUserSchema = z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    companyName: z.string().min(2, { message: 'Company name is required' }).optional(), // Optional on CreateUser (e.g. invites), required on Signup
    role: z.enum(['admin', 'editor', 'viewer', 'user'], {
        message: 'Role must be admin, editor, viewer, or user',
    }).optional().default('user'),
    password: z.string().min(8, { message: 'Password must be at least 8 characters' }).optional(),
});

export const SignupSchema = CreateUserSchema.extend({
    password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
    companyName: z.string().min(2, { message: 'Company name is required' }),
});

/**
 * Request class generated from the Zod Schema.
 * Used by NestJS for type inference and validation pipes.
 */
export class CreateUser extends createZodDto(CreateUserSchema) { }
export class Signup extends createZodDto(SignupSchema) { }
