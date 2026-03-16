import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  connectionStorageRegistry,
} from '@nexiom/database';
import type { DrizzleDb } from '@nexiom/database';
import { eq, type InferSelectModel } from 'drizzle-orm';

export type HostContext = InferSelectModel<typeof connectionStorageRegistry>;

@Injectable()
export class StorageResolverService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /**
   * Resolves the physical PostgreSQL schema name for a connection.
   * Used by Ingestion and Replica workers for 'SET search_path'.
   */
  async resolveSchemaName(connectionId: string): Promise<string> {
    const registryEntry = await this.db
      .select({ dataNamespace: connectionStorageRegistry.dataNamespace })
      .from(connectionStorageRegistry)
      .where(eq(connectionStorageRegistry.connectionId, connectionId))
      .limit(1);

    if (registryEntry.length === 0) {
      throw new NotFoundException(
        `Infrastructure Error: Connection ${connectionId} has no physical storage schema assigned.`,
      );
    }

    return registryEntry[0].dataNamespace;
  }

  /**
   * Retrieves host and region context for the connection.
   * Critical for multi-region routing and residency compliance.
   */
  async getHostContext(connectionId: string): Promise<HostContext> {
    const registryEntry = await this.db
      .select()
      .from(connectionStorageRegistry)
      .where(eq(connectionStorageRegistry.connectionId, connectionId))
      .limit(1);

    if (registryEntry.length === 0) {
      throw new NotFoundException(
        `No infrastructure registry found for connection: ${connectionId}`,
      );
    }

    return registryEntry[0];
  }
}
