import { z } from "zod";

export const envValidationSchema = z
  .object({
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
    ENCRYPTION_KEY: z.string().optional(),
    KMS_KEY_ID: z.string().optional(),
    JWT_SECRET: z.string().min(32),

    // Identity Constants
    SYSTEM_TENANT_ID: z.string().uuid(),
    OWNER_ROLE_ID: z.string().min(1),
    ADMIN_ROLE_ID: z.string().min(1),
    MEMBER_ROLE_ID: z.string().min(1),

    // Infrastructure
    REDIS_URL: z.string().url().optional(),
    INFRA_MODE: z.enum(["local", "aws"]).optional().default("local"),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    if (data.INFRA_MODE === "aws") {
      if (!data.KMS_KEY_ID || data.KMS_KEY_ID.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["KMS_KEY_ID"],
          message: "KMS_KEY_ID is required when INFRA_MODE is aws",
        });
      }
    } else {
      if (!data.ENCRYPTION_KEY || data.ENCRYPTION_KEY.length !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ENCRYPTION_KEY"],
          message: "ENCRYPTION_KEY must be exactly 32 characters when INFRA_MODE is local",
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envValidationSchema>;

/**
 * Validates the raw environment variables against the Zod schema.
 * Throws a clear error if validation fails.
 */
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envValidationSchema.safeParse(config);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    parsed.error.issues.forEach((issue) => {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    });
    throw new Error("Environment validation failed");
  }

  return parsed.data;
}
