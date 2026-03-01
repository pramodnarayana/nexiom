import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { DrizzleDb } from '@nexiom/database';
import { connectionStorageRegistry } from '@nexiom/database/src/schema/storage_registry';
import { eq } from 'drizzle-orm';

@Injectable()
export class StorageResolverService {
  constructor(@Inject('DATABASE_CONNECTION') private readonly db: DrizzleDb) {}

  /**
   * Resolves the physical PostgreSQL schema name (workspaceId) for a connection.
   * Used by Ingestion and Replica workers for 'SET search_path'.
   */
  async resolveSchemaName(connectionId: string): Promise<string> {
    const registryEntry = await this.db
      .select({ workspaceId: connectionStorageRegistry.workspaceId })
      .from(connectionStorageRegistry)
      .where(eq(connectionStorageRegistry.connectionId, connectionId))
      .limit(1);

    if (registryEntry.length === 0) {
      throw new NotFoundException(
        `Infrastructure Error: Connection ${connectionId} has no physical storage workspace assigned.`,
      );
    }

    return registryEntry[0].workspaceId;
  }

  /**
   * Retrieves host and region context for the connection.
   * Critical for multi-region routing and residency compliance.
   */
  async getHostContext(connectionId: string) {
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
