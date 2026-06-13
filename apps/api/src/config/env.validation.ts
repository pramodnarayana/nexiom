import { z } from 'zod';

const baseSchema = z.object({
  // Base Settings
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  API_URL: z.string().url().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Authentication & Security
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().optional(),
  JWT_SECRET: z.string().min(32),

  // Identity Constants
  SYSTEM_TENANT_ID: z.string().uuid(),
  OWNER_ROLE_ID: z.string().min(1),
  ADMIN_ROLE_ID: z.string().min(1),
  MEMBER_ROLE_ID: z.string().min(1),

  // Infrastructure
  REDIS_URL: z.string().url().optional(),
  INFRA_MODE: z.enum(['local', 'aws', 'kms']).default('local'),
});

const localInfraSchema = baseSchema.extend({
  INFRA_MODE: z.literal('local'),
  ENCRYPTION_KEY: z
    .string()
    .length(32, { message: 'Encryption key must be exactly 32 characters' }),
  KMS_KEY_ID: z.string().optional(),
});

const awsInfraSchema = baseSchema.extend({
  INFRA_MODE: z.enum(['aws', 'kms']),
  KMS_KEY_ID: z.string().min(1, { message: 'KMS_KEY_ID is required when INFRA_MODE is aws or kms' }),
  ENCRYPTION_KEY: z.string().optional(),
});

export const envValidationSchema = z
  .discriminatedUnion('INFRA_MODE', [
    localInfraSchema,
    awsInfraSchema,
  ])
  .passthrough();

export type EnvConfig = z.infer<typeof envValidationSchema>;

/**
 * Validates the raw environment variables against the Zod schema.
 * Throws a clear error if validation fails.
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envValidationSchema.safeParse(config);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    parsed.error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
    throw new Error('Environment validation failed');
  }

  return parsed.data;
}
