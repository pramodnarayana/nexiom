/** Injection token for the single shared Redis client across the entire application. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Injection token for the key-value store interface (backed by Redis). */
export const KEY_VALUE_STORE = 'KEY_VALUE_STORE';

/** Injection token for generic Pub/Sub interface. */
export const PUB_SUB_CLIENT = 'PUB_SUB_CLIENT';
