/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { ObjectDescriptor, FieldDescriptor } from '@soopa/piece-framework';
import {
  CANONICAL_SCHEMA_PROVIDERS,
  type SchemaRegistryInput,
  type CanonicalSchemaRepositoryPort,
} from '../../core/ports/outbound/canonical-schema.repository.port.js';

@Injectable()
export class DrizzleCanonicalSchemaAdapter implements CanonicalSchemaRepositoryPort {
  private readonly logger = new Logger(DrizzleCanonicalSchemaAdapter.name);
  private tables: Record<string, PgTable<any>> = {};

  constructor(
    @Inject(CANONICAL_SCHEMA_PROVIDERS)
    private readonly schemaProviders: SchemaRegistryInput[],
  ) {
    // Register all tables by their uppercase table name (e.g., 'TMS_CUSTOMER')
    for (const schema of this.schemaProviders) {
      for (const table of Object.values(schema)) {
        const pgTable = table;
        const tableName = getTableName(pgTable).toUpperCase();

        if (tableName in this.tables) {
          throw new Error(
            `Duplicate canonical table name detected: ${tableName}`,
          );
        }

        this.tables[tableName] = pgTable;
      }
    }
  }

  async listObjects(): Promise<ObjectDescriptor[]> {
    const objects: ObjectDescriptor[] = [];
    for (const name of Object.keys(this.tables)) {
      objects.push({
        name,
        // Create a human readable label by converting TMS_CUSTOMER -> Tms Customer
        label: name
          .split('_')
          .map((word: string) => word.charAt(0) + word.slice(1).toLowerCase())
          .join(' '),
        queryable: true,
      });
    }
    return objects;
  }

  async listFields(objectName: string): Promise<FieldDescriptor[]> {
    const table = this.tables[objectName.toUpperCase()];
    if (!table) {
      this.logger.warn(
        `Canonical schema reflection requested for unknown object: ${objectName}`,
      );
      return [];
    }

    const columns = getTableColumns(table);
    const fields: FieldDescriptor[] = [];

    const INTERNAL_COLUMNS = [
      'id',
      'trace_id',
      'replica_id',
      'data_source_id',
      'source_id',
      'created_at',
      'updated_at',
    ];

    for (const c of Object.values(columns)) {
      const col = c as PgColumn<any>;
      if (INTERNAL_COLUMNS.includes(col.name)) {
        continue;
      }

      // Map Drizzle dataTypes to standard Piece Framework types
      let type = 'string';
      if (col.dataType === 'date') type = 'datetime';
      if (col.dataType === 'number') type = 'number';
      if (col.dataType === 'boolean') type = 'boolean';
      if (col.dataType === 'array') type = 'array';
      if (col.dataType === 'json') type = 'object';

      fields.push({
        name: col.name, // The actual DB column name (e.g. 'billing_street')
        // Create a human readable label by converting billing_street -> Billing Street
        label: col.name
          .split('_')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
        type,
        filterable: true, // Typically all canonical fields are filterable
        sortable: true,
        nillable: !col.notNull,
      });
    }

    return fields;
  }
}
