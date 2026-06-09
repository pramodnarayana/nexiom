/**
 * Key-value store abstraction for persisting integration state.
 *
 * Keys are expected to be scoped/namespaced by the caller (e.g., "connection:123:token").
 * Implementers should handle storage errors by throwing descriptive Error instances.
 * Operations are asynchronous; no atomicity or transactionality guarantees are provided.
 */
export interface StorePort {
  /**
   * Retrieves the value associated with the given key.
   * @param key - The storage key (caller-managed scope/namespace)
   * @returns A promise resolving to the stored value, or null if the key does not exist
   * @throws Error if the storage operation fails (e.g., network error, permissions)
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Stores a value under the given key, overwriting any existing value.
   * @param key - The storage key (caller-managed scope/namespace)
   * @param value - The value to store
   * @returns A promise that resolves when the operation completes
   * @throws Error if the storage operation fails
   */
  put<T>(key: string, value: T): Promise<void>;

  /**
   * Deletes the value associated with the given key. Idempotent (no error if key does not exist).
   * @param key - The storage key (caller-managed scope/namespace)
   * @returns A promise that resolves when the operation completes
   * @throws Error if the storage operation fails
   */
  delete(key: string): Promise<void>;
}
