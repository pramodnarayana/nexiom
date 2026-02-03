import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Role constants for consistent usage across the codebase
 */
export const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  USER: 'user',
} as const;

/**
 * Shared role enum for consistent validation across schemas
 * Derived from ROLES constant to ensure single source of truth
 */
const RoleEnum = z.enum(Object.values(ROLES) as [string, ...string[]], {
  message: 'Role must be admin, editor, viewer, or user',
});

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
  role: RoleEnum.optional().default('user'),
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
  role: RoleEnum.default('user'),
});

export class InviteUser extends createZodDto(InviteUserSchema) {}
