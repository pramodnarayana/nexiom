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
  companyName: z
    .string()
    .min(2, { message: 'Company name is required' })
    .optional(), // Optional on CreateUser (e.g. invites), required on Signup
  role: z
    .enum(['admin', 'editor', 'viewer', 'user'], {
      message: 'Role must be admin, editor, viewer, or user',
    })
    .optional()
    .default('user'),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' })
    .optional(),
});

export const SignupSchema = CreateUserSchema.extend({
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' }),
  companyName: z
    .string()
    .min(2, { message: 'Company name is required' })
    .optional(),
});

/**
 * Request class generated from the Zod Schema.
 * Used by NestJS for type inference and validation pipes.
 */
export class CreateUser extends createZodDto(CreateUserSchema) {}
export class Signup extends createZodDto(SignupSchema) {}

export const CompleteInviteSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters' }),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  invitationId: z.string().uuid(),
});

export class CompleteInvite extends createZodDto(CompleteInviteSchema) {}

export const InviteUserSchema = z.object({
  email: z.string().email(),
  role: z
    .enum(['admin', 'editor', 'viewer', 'user'], {
      message: 'Role must be admin, editor, viewer, or user',
    })
    .default('user'),
});

export class InviteUser extends createZodDto(InviteUserSchema) {}
