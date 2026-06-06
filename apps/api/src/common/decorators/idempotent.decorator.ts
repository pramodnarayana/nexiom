import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

export interface IdempotencyOptions {
  keyIndex?: number; // the index of the argument to use as the idempotency key
  keyResolver?: (...args: any[]) => string;
  ttlSeconds?: number;
}

export const Idempotent = (options?: IdempotencyOptions) =>
  SetMetadata(IDEMPOTENT_KEY, options ?? {});
