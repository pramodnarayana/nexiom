export interface StateStorePort {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
