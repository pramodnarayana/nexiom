import type { ObjectDescriptor, FieldDescriptor } from '@soopa/piece-framework';
import type { PgTable } from 'drizzle-orm/pg-core';

export const CANONICAL_SCHEMA_REPOSITORY_PORT = Symbol(
  'CANONICAL_SCHEMA_REPOSITORY_PORT',
);
export const CANONICAL_SCHEMA_PROVIDERS = Symbol('CANONICAL_SCHEMA_PROVIDERS');

export type SchemaRegistryInput = Record<string, PgTable<any>>;

export interface CanonicalSchemaRepositoryPort {
  listObjects(): Promise<ObjectDescriptor[]>;
  listFields(objectName: string): Promise<FieldDescriptor[]>;
}
