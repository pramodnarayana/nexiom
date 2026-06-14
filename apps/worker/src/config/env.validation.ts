import { z } from "zod";

const baseSchema = z.object({
  // Base Settings
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
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
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Infrastructure
  REDIS_URL: z.string().url().optional(),

  // Webhooks
  GITOPS_WEBHOOK_SECRET: z.string().optional(),
  NPM_WEBHOOK_SECRET: z.string().optional(),

  // Scheduler / Windmill
  WINDMILL_ENABLED: z.coerce.boolean().default(false),
  WINDMILL_BASE_URL: z.string().url().optional(),
  WINDMILL_WORKSPACE: z.string().optional(),
  WINDMILL_TOKEN: z.string().optional(),
  WINDMILL_INTERNAL_SECRET: z.string().optional(),
  WINDMILL_CALLBACK_URL: z.string().optional(),

  // Observability
  LOG_LEVEL: z.string().default("info"),
  OPENOBSERVE_URL: z.string().optional(),
  OPENOBSERVE_ORG: z.string().optional(),
  OPENOBSERVE_STREAM: z.string().optional(),
  OPENOBSERVE_TOKEN: z.string().optional(),

  // Plugins
  PLUGINS_PATH: z.string().optional(),
  DISABLE_LOCAL_SYNC: z.string().optional(),
  NPM_REGISTRY_URL: z.string().url().optional(),
});

const localInfraSchema = baseSchema.extend({
  INFRA_MODE: z.literal("local").default("local"),
  ENCRYPTION_KEY: z.string().length(32),
});

const awsInfraSchema = baseSchema.extend({
  INFRA_MODE: z.literal("aws"),
  KMS_KEY_ID: z.string().min(1),
  ENCRYPTION_KEY: z.string().optional(),
});

const kmsInfraSchema = baseSchema.extend({
  INFRA_MODE: z.literal("kms"),
  KMS_KEY_ID: z.string().min(1),
  ENCRYPTION_KEY: z.string().optional(),
});

export const envValidationSchema = z.discriminatedUnion("INFRA_MODE", [
  localInfraSchema,
  awsInfraSchema,
  kmsInfraSchema,
]);

export type EnvConfig = z.infer<typeof envValidationSchema>;

/**
 * Validates the raw environment variables against the Zod schema.
 * Throws a clear error if validation fails.
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  // Preprocess to inject default INFRA_MODE if missing
  const configWithDefaults = {
    ...config,
    INFRA_MODE: config.INFRA_MODE ?? "local",
  };

  const parsed = envValidationSchema.safeParse(configWithDefaults);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    parsed.error.issues.forEach((issue: z.ZodIssue) => {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    });
    throw new Error("Environment validation failed");
  }

  return parsed.data;
}
