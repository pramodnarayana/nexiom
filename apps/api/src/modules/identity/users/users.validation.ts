import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * Role constants for consistent usage across the codebase
 */
export const ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
  MEMBER: 'member',
} as const;

/**
 * Shared role validation
 * Changed to string to support dynamic DB-driven roles.
 */
const RoleEnum = z
  .string()
  .min(1, 'Role is required')
  .max(50, 'Role too long')
  .regex(
    /^[a-z0-9-_]+$/,
    'Role must be lowercase alphanumeric with hyphens/underscores',
  );

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
  role: RoleEnum.optional().default('member'),
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
  role: RoleEnum.default('member'),
});

export class InviteUser extends createZodDto(InviteUserSchema) {}
