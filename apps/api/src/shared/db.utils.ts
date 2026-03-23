/** Postgres unique-constraint violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorInfo {
  code: string;
  constraint?: string;
}

/**
 * Extracts the underlying Postgres error fields (code, constraint) from either:
 *  - A raw `pg` / `postgres.js` error object, or
 *  - A Drizzle-wrapped error (DrizzleQueryError) where the original pg error
 *    lives on `.cause`.
 *
 * Returns null if `err` does not resemble a pg error at either level.
 */
export function extractPgError(err: unknown): PgErrorInfo | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;

  if (typeof e['code'] === 'string') {
    return {
      code: e['code'],
      constraint: e['constraint'] as string | undefined,
    };
  }

  const cause = e['cause'];
  if (typeof cause === 'object' && cause !== null) {
    const c = cause as Record<string, unknown>;
    if (typeof c['code'] === 'string') {
      return {
        code: c['code'],
        constraint: c['constraint'] as string | undefined,
      };
    }
  }

  return null;
}

/**
 * Returns true when `err` represents a Postgres unique-constraint violation.
 *
 * Handles two shapes:
 *  - Raw `pg` / `postgres.js` error:  err.code === '23505'
 *  - Drizzle-wrapped error:            err.cause.code === '23505'
 *    (Drizzle rethrows as DrizzleQueryError with the original pg error on .cause)
 */
export function isUniqueViolation(err: unknown): boolean {
  return extractPgError(err)?.code === PG_UNIQUE_VIOLATION;
}
