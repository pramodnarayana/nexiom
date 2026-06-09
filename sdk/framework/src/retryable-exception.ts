/**
 * Thrown by piece.executeAction() implementations to signal a transient
 * vendor-side failure (e.g. 429 Too Many Requests, 503 Service Unavailable).
 *
 * DeliveryService catches this to transition outbound_gateway status → 'RETRY'
 * instead of 'FAIL', preserving the delivery outbox row for re-attempt with
 * exponential backoff via OutboundOutboxWorker.
 *
 * Non-retryable failures (400 bad payload, 401 auth, 404 not found) should
 * NOT use this — they should propagate as plain errors so the row is marked
 * 'FAIL' and surfaced in the Exception Center for operator review.
 *
 * @example
 * ```typescript
 * if (res.status === 429) {
 *   throw new RetryableException('Rate limit exceeded', 429);
 * }
 * ```
 */
export class RetryableException extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'RetryableException';
    this.statusCode = statusCode;
    // Restore prototype chain broken by TypeScript class extension
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
