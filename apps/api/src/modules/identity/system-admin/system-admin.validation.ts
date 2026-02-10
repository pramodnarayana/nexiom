import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  getRequiredAdminRoleId,
  getRequiredOwnerRoleId,
} from '../../../constants';

export const CreateTenantSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .regex(/^[a-z0-9-]+$/, {
      message: 'Slug must contain only lowercase letters, numbers, and hyphens',
    }),
  logo: z.string().url().optional().or(z.literal('')),
});

export class CreateTenantValidation extends createZodDto(CreateTenantSchema) {}

export const UpdateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z
    .string()
    .min(3)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  logo: z.string().url().optional().or(z.literal('')),
  status: z.enum(['active', 'disabled', 'suspended']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export class UpdateTenantValidation extends createZodDto(UpdateTenantSchema) {}

export const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(), // In case we want to allow email updates, though risky
  emailVerified: z.boolean().optional(),
});

export class UpdateUserValidation extends createZodDto(UpdateUserSchema) {}

export const buildCreateUserSchema = () => {
  // We need to assert this is a non-empty array of strings for Zod enum
  const roles = [getRequiredOwnerRoleId(), getRequiredAdminRoleId()] as [
    string,
    ...string[],
  ];

  return z.object({
    name: z.string().min(1, { message: 'Name is required' }),
    email: z.string().email({ message: 'Invalid email address' }),
    role: z.enum(roles).optional().default(getRequiredAdminRoleId()),
  });
};

// Getter to access the schema (built lazily on first access and cached)
let _cachedCreateUserSchema: ReturnType<typeof buildCreateUserSchema> | null =
  null;

export const getCreateUserSchema = () => {
  _cachedCreateUserSchema ??= buildCreateUserSchema();
  return _cachedCreateUserSchema;
};

// For backward compatibility where a static schema is expected, use z.lazy
// This defers the actual building until validation time
export const CreateUserSchema = z.lazy(() => getCreateUserSchema());

// Export the DTO class for NestJS validation
export class CreateUserValidation extends createZodDto(CreateUserSchema) {}

// Export the inferred type for TypeScript usage
export type CreateUserDto = z.infer<ReturnType<typeof buildCreateUserSchema>>;

// Reuse the same schema logic for system invitations
export const buildCreateSystemInvitationSchema = () => {
  return buildCreateUserSchema().pick({ email: true, role: true });
};

// Type inference from schema
export type CreateSystemInvitationDto = z.infer<
  ReturnType<typeof buildCreateSystemInvitationSchema>
>;
