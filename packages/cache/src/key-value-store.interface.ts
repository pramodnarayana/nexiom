export interface IKeyValueStore {
  set(key: string, value: string | Buffer | number, mode?: string, duration?: number, flag?: string): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, numkeys: number, ...args: (string | Buffer | number)[]): Promise<unknown>;
  lpush(key: string, ...values: (string | Buffer | number)[]): Promise<number>;
  rpop(key: string): Promise<string | null>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string | Buffer | number): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  scan(cursor: string, matchOption: 'MATCH', matchPattern: string, countOption: 'COUNT', count: number): Promise<[string, string[]]>;
}
