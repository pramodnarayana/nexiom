/**
 * Shared utilities for all pipeline layer workers (L2–L6).
 *
 * Centralises cross-cutting concerns:
 *  - Error sanitization before logging or DB persistence
 *  - HTTP status code retry classification
 *  - Poison-pill message validation
 */

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------

/**
 * Returns a log/DB-safe version of an error.
 *
 * - Strips URL credentials: `https://user:token@host` → `https://[REDACTED]@host`
 * - Truncates to 500 characters (matches `last_error` column VARCHAR(500) length)
 *
 * Workers MUST call this before persisting error messages to `last_error` columns
 * or emitting them in structured log fields, since vendor API errors may contain
 * OAuth tokens, connection strings, or other sensitive material in their messages.
 */
export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const stripped = msg.replaceAll(/\/\/[^@\s]*@/g, "//[REDACTED]@");
  return stripped.length > 500 ? `${stripped.slice(0, 500)}…` : stripped;
}

// ---------------------------------------------------------------------------
// HTTP retry classification
// ---------------------------------------------------------------------------

/**
 * HTTP status codes that indicate a transient vendor-side failure.
 *
 * - 429: Too Many Requests (rate limit) — back off and retry
 * - 502: Bad Gateway — upstream unavailable, transient
 * - 503: Service Unavailable — vendor maintenance, retry
 * - 504: Gateway Timeout — upstream slow, retry
 *
 * All other non-2xx codes are permanent failures — the row should be
 * marked FAIL and surfaced in the Exception Center for operator action.
 */
export const RETRYABLE_STATUS_CODES = new Set<number>([429, 502, 503, 504]);

/**
 * Returns true if the HTTP status code represents a transient failure that
 * should be retried with exponential backoff via the delivery outbox worker.
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

// ---------------------------------------------------------------------------
// Message validation
// ---------------------------------------------------------------------------

/**
 * Validates that a pipeline queue message contains the minimum required fields.
 *
 * Returns true if the message is valid.
 * Returns false if the message is a poison pill — the caller should log a
 * warning and return (ACK) without throwing, to avoid infinite redelivery.
 */
export function isValidPipelineMessage(
  msg: Record<string, unknown>,
  requiredFields: string[],
): boolean {
  for (const field of requiredFields) {
    if (typeof msg[field] !== "string" || msg[field].length === 0) {
      return false;
    }
  }
  return true;
}
