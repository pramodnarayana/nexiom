import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

@Injectable()
export class TriggerPayloadTransformer {
  /**
   * Extracts a cursor value from a trigger record.
   */
  extractRecordCursor(record: unknown): string {
    if (record !== null && typeof record === 'object') {
      const r = record as Record<string, unknown>;
      for (const key of ['LastModifiedDate', '_cursor', 'CreatedDate']) {
        if (typeof r[key] === 'string' && r[key]) return r[key] as string;
      }
    }
    return new Date().toISOString();
  }

  /**
   * Builds a stable, bounded fingerprint for a trigger record.
   */
  buildSourceEventId(
    workspaceId: string,
    triggerName: string,
    record: unknown,
  ): string {
    const FINGERPRINT_MAX_BYTES = 4096;
    const VOLATILE_KEYS = new Set([
      'SystemModstamp',
      'LastModifiedDate',
      'LastReferencedDate',
      'LastViewedDate',
      '_etag',
      'etag',
      'version',
      '__v',
    ]);

    let payload: string;
    try {
      if (
        record !== null &&
        typeof record === 'object' &&
        !Array.isArray(record)
      ) {
        const sorted = Object.keys(record as Record<string, unknown>)
          .filter((k) => !VOLATILE_KEYS.has(k))
          .sort((a, b) => (a ?? '').localeCompare(b ?? ''))
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (record as Record<string, unknown>)[k];
            return acc;
          }, {});
        const stringified = JSON.stringify(sorted);
        payload = stringified ?? '{}';
      } else {
        const stringified = JSON.stringify(record);
        payload = stringified ?? String(record);
      }
    } catch {
      // Fallback if JSON.stringify fails or returns undefined
      payload = String(record);
    }

    const bounded =
      payload.length > FINGERPRINT_MAX_BYTES
        ? payload.slice(0, FINGERPRINT_MAX_BYTES)
        : payload;

    return createHash('sha256')
      .update(`${workspaceId}:${triggerName}:${bounded}`)
      .digest('hex');
  }

  /**
   * Parses webhook body payload safely.
   */
  parseWebhookPayload(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString('utf-8')) as unknown;
    } catch {
      return rawBody;
    }
  }

  /**
   * Derives webhook lock hash
   */
  buildWebhookLockHash(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex').slice(0, 16);
  }
}
