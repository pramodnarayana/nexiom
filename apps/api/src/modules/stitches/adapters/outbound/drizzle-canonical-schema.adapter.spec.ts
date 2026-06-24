import { describe, it, expect, beforeEach } from 'vitest';
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';
import { DrizzleCanonicalSchemaAdapter } from './drizzle-canonical-schema.adapter.js';
import type { SchemaRegistryInput } from '../../core/ports/outbound/canonical-schema.repository.port.js';

// No mocks for pure logic. We define a real Drizzle PgTable object to pass in.
const mockUsersTable = pgTable('mock_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull(),
  isActive: boolean('is_active').default(true),
  age: integer('age'),
  metadata: jsonb('metadata'),
});

const mockSchema: SchemaRegistryInput = {
  users: mockUsersTable,
};

describe('DrizzleCanonicalSchemaAdapter', () => {
  let adapter: DrizzleCanonicalSchemaAdapter;

  beforeEach(() => {
    // Inject real schema definitions, no mocking of the adapter or dependencies.
    adapter = new DrizzleCanonicalSchemaAdapter([mockSchema]);
  });

  describe('listObjects', () => {
    it('should return a list of registered canonical objects', async () => {
      const objects = await adapter.listObjects();

      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        name: 'MOCK_USERS',
        label: 'Mock Users',
        queryable: true,
      });
    });
  });

  describe('listFields', () => {
    it('should return a list of mapped fields for a known object, excluding internal columns', async () => {
      const fields = await adapter.listFields('MOCK_USERS');

      // We expect 'name', 'is_active', 'age', 'metadata'.
      // 'id', 'created_at' are filtered out.
      expect(fields).toHaveLength(4);

      expect(fields.find((f) => f.name === 'name')).toEqual({
        name: 'name',
        label: 'Name',
        type: 'string',
        filterable: true,
        sortable: true,
        nillable: false,
      });

      // Verify boolean column
      expect(fields.find((f) => f.name === 'is_active')).toEqual({
        name: 'is_active',
        label: 'Is Active',
        type: 'boolean',
        filterable: true,
        sortable: true,
        nillable: true,
      });

      // Verify integer column
      expect(fields.find((f) => f.name === 'age')).toEqual({
        name: 'age',
        label: 'Age',
        type: 'number',
        filterable: true,
        sortable: true,
        nillable: true,
      });

      // Verify jsonb column
      expect(fields.find((f) => f.name === 'metadata')).toEqual({
        name: 'metadata',
        label: 'Metadata',
        type: 'object',
        filterable: true,
        sortable: true,
        nillable: true,
      });
    });

    it('should return an empty array for an unknown object', async () => {
      const fields = await adapter.listFields('UNKNOWN_TABLE');
      expect(fields).toEqual([]);
    });
  });
});
