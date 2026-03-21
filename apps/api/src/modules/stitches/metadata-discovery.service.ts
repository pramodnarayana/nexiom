import {
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  connectorObjectProfiles,
  safeAppConnectionColumns,
  appConnections,
} from '@nexiom/database';
import { REDIS_CLIENT, type Redis } from '@nexiom/cache';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '@nexiom/connectors';
import { PieceRegistryService } from '../trigger/piece-registry.service.js';
import type { ObjectDescriptor, FieldDescriptor } from '@nexiom/connectors';
import type { ConnectionValueBlob } from '../connections/connectors.service.js';

// Single source of truth for metadata cache TTL.
const TTL_SECONDS = 5 * 60; // 5 minutes
const TTL_MS = TTL_SECONDS * 1_000;

const MAX_OBJECTS = 500; // guard against excessively large payloads

@Injectable()
export class MetadataDiscoveryService {
  private readonly logger = new Logger(MetadataDiscoveryService.name);
  private readonly prismSalesforceUrl: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly pieceRegistry: PieceRegistryService,
    private readonly encryption: EncryptionService,
  ) {
    this.prismSalesforceUrl = this.configService.get(
      'PRISM_SALESFORCE_URL',
      'http://localhost:4010',
    );
  }

  async describeObjects(
    orgId: string,
    connectionId: string,
    limit = MAX_OBJECTS,
  ): Promise<ObjectDescriptor[]> {
    const effectiveLimit = Math.max(1, Math.min(limit, MAX_OBJECTS));
    const connection = await this.resolveConnection(orgId, connectionId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:objects:${connectionId}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      const all = JSON.parse(cached) as ObjectDescriptor[];
      return all.slice(0, effectiveLimit);
    }

    // ── 2. DB cache ──────────────────────────────────────────────────────────
    const dbRows = await this.db
      .select()
      .from(connectorObjectProfiles)
      .where(eq(connectorObjectProfiles.connectionId, connectionId));

    if (dbRows.length > 0) {
      const allFresh = dbRows.every(
        (row) =>
          row.updatedAt &&
          Date.now() - new Date(row.updatedAt).getTime() < TTL_MS,
      );
      if (allFresh) {
        const objects: ObjectDescriptor[] = dbRows.map((row) => ({
          name: row.objectName,
          label: row.objectName,
          queryable: true,
        }));
        await this.redis.set(
          redisKey,
          JSON.stringify(objects),
          'EX',
          TTL_SECONDS,
        );
        return objects.slice(0, effectiveLimit);
      }
    }

    // ── 3. Live fetch (piece → Prism fallback) ───────────────────────────────
    const credentials = await this.resolveCredentials(orgId, connectionId);
    const objects = await this.fetchObjects(
      connection.appName,
      connectionId,
      credentials,
    );

    await this.redis.set(redisKey, JSON.stringify(objects), 'EX', TTL_SECONDS);

    // Batch upsert all object names into the DB cache in a single statement.
    if (objects.length > 0) {
      await this.db
        .insert(connectorObjectProfiles)
        .values(
          objects.map((obj) => ({
            connectionId,
            objectName: obj.name,
            profile: {},
          })),
        )
        .onConflictDoUpdate({
          target: [
            connectorObjectProfiles.connectionId,
            connectorObjectProfiles.objectName,
          ],
          set: { updatedAt: new Date() },
        });
    }

    return objects.slice(0, effectiveLimit);
  }

  async describeFields(
    orgId: string,
    connectionId: string,
    objectName: string,
  ): Promise<FieldDescriptor[]> {
    const connection = await this.resolveConnection(orgId, connectionId);

    // ── 1. Redis cache ───────────────────────────────────────────────────────
    const redisKey = `meta:fields:${connectionId}:${objectName}`;
    const cached = await this.redis.get(redisKey);
    if (cached) {
      return JSON.parse(cached) as FieldDescriptor[];
    }

    // ── 2. DB cache ──────────────────────────────────────────────────────────
    const [dbRow] = await this.db
      .select()
      .from(connectorObjectProfiles)
      .where(
        and(
          eq(connectorObjectProfiles.connectionId, connectionId),
          eq(connectorObjectProfiles.objectName, objectName),
        ),
      )
      .limit(1);

    if (
      dbRow?.updatedAt &&
      Date.now() - new Date(dbRow.updatedAt).getTime() < TTL_MS
    ) {
      const profile = dbRow.profile;
      if (Array.isArray(profile) && profile.length > 0) {
        await this.redis.set(
          redisKey,
          JSON.stringify(profile),
          'EX',
          TTL_SECONDS,
        );
        return profile as FieldDescriptor[];
      }
    }

    // ── 3. Live fetch (piece → Prism fallback) ───────────────────────────────
    const credentials = await this.resolveCredentials(orgId, connectionId);
    const fields = await this.fetchFields(
      connection.appName,
      connectionId,
      objectName,
      credentials,
    );

    await this.redis.set(redisKey, JSON.stringify(fields), 'EX', TTL_SECONDS);

    await this.db
      .insert(connectorObjectProfiles)
      .values({ connectionId, objectName, profile: fields })
      .onConflictDoUpdate({
        target: [
          connectorObjectProfiles.connectionId,
          connectorObjectProfiles.objectName,
        ],
        set: { profile: fields, updatedAt: new Date() },
      });

    return fields;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Fetches the connection row, enforcing org ownership. */
  private async resolveConnection(orgId: string, connectionId: string) {
    const [connection] = await this.db
      .select(safeAppConnectionColumns)
      .from(appConnections)
      .where(
        and(
          eq(appConnections.id, connectionId),
          eq(appConnections.tenantId, orgId),
        ),
      )
      .limit(1);

    if (!connection) {
      throw new NotFoundException(`Connection ${connectionId} not found.`);
    }
    return connection;
  }

  /**
   * Fetches the encrypted `value` column, decrypts it, and returns the parsed
   * credential blob.  The `value` column is intentionally excluded from
   * `safeAppConnectionColumns`; this is one of the two permitted call sites
   * (the other is ConnectorsController for credential display).
   */
  private async resolveCredentials(
    orgId: string,
    connectionId: string,
  ): Promise<Record<string, unknown>> {
    const [row] = await this.db
      .select({ value: appConnections.value })
      .from(appConnections)
      .where(
        and(
          eq(appConnections.id, connectionId),
          eq(appConnections.tenantId, orgId),
        ),
      )
      .limit(1);

    if (!row?.value) return {};

    try {
      const decrypted = await this.encryption.decrypt(row.value);
      const blob = JSON.parse(decrypted) as ConnectionValueBlob;
      // Expose the fields pieces typically need for API calls.
      return {
        accessToken: blob.accessToken,
        refreshToken: blob.refreshToken,
        clientId: blob.clientId,
        ...blob.data,
        ...(blob.vendorParams ?? {}),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Failed to decrypt credentials for connection ${connectionId}: ${msg}`,
      );
      throw new InternalServerErrorException(
        'Failed to decrypt connection credentials.',
      );
    }
  }

  private async fetchObjects(
    appName: string,
    _connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<ObjectDescriptor[]> {
    const piece = this.pieceRegistry.getPiece(appName);
    if (piece?.describeObjects) {
      return piece.describeObjects(credentials);
    }

    if (appName === 'salesforce') {
      const res = await fetch(
        `${this.prismSalesforceUrl}/services/data/v59.0/sobjects`,
        {
          headers:
            typeof credentials.accessToken === 'string' &&
            credentials.accessToken
              ? { Authorization: `Bearer ${credentials.accessToken}` }
              : {},
        },
      );
      if (!res.ok) {
        throw new InternalServerErrorException(
          `Salesforce sobjects request failed with status ${res.status}.`,
        );
      }
      const data = (await res.json()) as { sobjects?: ObjectDescriptor[] };
      if (!Array.isArray(data.sobjects)) {
        throw new InternalServerErrorException(
          'Unexpected response from Salesforce sobjects endpoint.',
        );
      }
      return data.sobjects.map((s) => ({
        name: s.name,
        label: s.label,
        queryable: s.queryable,
      }));
    }

    if (appName === 'quickbooks') {
      return [
        { name: 'Customer', label: 'Customer', queryable: true },
        { name: 'Invoice', label: 'Invoice', queryable: true },
        { name: 'Item', label: 'Item', queryable: true },
        { name: 'Payment', label: 'Payment', queryable: true },
        { name: 'Vendor', label: 'Vendor', queryable: true },
      ];
    }

    throw new NotFoundException(
      'Metadata discovery not supported for this connector.',
    );
  }

  private async fetchFields(
    appName: string,
    _connectionId: string,
    objectName: string,
    credentials: Record<string, unknown>,
  ): Promise<FieldDescriptor[]> {
    const piece = this.pieceRegistry.getPiece(appName);
    if (piece?.describeFields) {
      return piece.describeFields(credentials, objectName);
    }

    if (appName === 'salesforce') {
      const res = await fetch(
        `${this.prismSalesforceUrl}/services/data/v59.0/sobjects/${encodeURIComponent(objectName)}/describe`,
        {
          headers:
            typeof credentials.accessToken === 'string' &&
            credentials.accessToken
              ? { Authorization: `Bearer ${credentials.accessToken}` }
              : {},
        },
      );
      if (!res.ok) {
        throw new InternalServerErrorException(
          `Salesforce describe request failed with status ${res.status}.`,
        );
      }
      const data = (await res.json()) as { fields?: FieldDescriptor[] };
      if (!Array.isArray(data.fields)) {
        throw new InternalServerErrorException(
          'Unexpected response from Salesforce describe endpoint.',
        );
      }
      return data.fields.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        filterable: f.filterable,
        sortable: f.sortable,
        nillable: f.nillable,
      }));
    }

    if (appName === 'quickbooks') {
      return this.getQuickBooksStubFields(objectName);
    }

    throw new NotFoundException(
      'Metadata discovery not supported for this connector.',
    );
  }

  private getQuickBooksStubFields(objectName: string): FieldDescriptor[] {
    const common: FieldDescriptor[] = [
      {
        name: 'Id',
        label: 'ID',
        type: 'string',
        filterable: true,
        sortable: true,
        nillable: false,
      },
    ];

    const fieldsByObject: Record<string, FieldDescriptor[]> = {
      Customer: [
        ...common,
        {
          name: 'DisplayName',
          label: 'Display Name',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: false,
        },
        {
          name: 'PrimaryEmailAddr',
          label: 'Email',
          type: 'string',
          filterable: true,
          sortable: false,
          nillable: true,
        },
        {
          name: 'PrimaryPhone',
          label: 'Phone',
          type: 'string',
          filterable: false,
          sortable: false,
          nillable: true,
        },
        {
          name: 'Balance',
          label: 'Balance',
          type: 'decimal',
          filterable: true,
          sortable: true,
          nillable: true,
        },
      ],
      Invoice: [
        ...common,
        {
          name: 'DocNumber',
          label: 'Document Number',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: true,
        },
        {
          name: 'TxnDate',
          label: 'Transaction Date',
          type: 'date',
          filterable: true,
          sortable: true,
          nillable: true,
        },
        {
          name: 'TotalAmt',
          label: 'Total Amount',
          type: 'decimal',
          filterable: true,
          sortable: true,
          nillable: false,
        },
        {
          name: 'CustomerRef',
          label: 'Customer Reference',
          type: 'reference',
          filterable: true,
          sortable: false,
          nillable: false,
        },
      ],
      Item: [
        ...common,
        {
          name: 'Name',
          label: 'Name',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: false,
        },
        {
          name: 'Type',
          label: 'Type',
          type: 'string',
          filterable: true,
          sortable: false,
          nillable: false,
        },
        {
          name: 'UnitPrice',
          label: 'Unit Price',
          type: 'decimal',
          filterable: true,
          sortable: true,
          nillable: true,
        },
      ],
      Payment: [
        ...common,
        {
          name: 'TotalAmt',
          label: 'Total Amount',
          type: 'decimal',
          filterable: true,
          sortable: true,
          nillable: false,
        },
        {
          name: 'TxnDate',
          label: 'Transaction Date',
          type: 'date',
          filterable: true,
          sortable: true,
          nillable: true,
        },
        {
          name: 'CustomerRef',
          label: 'Customer Reference',
          type: 'reference',
          filterable: true,
          sortable: false,
          nillable: false,
        },
      ],
      Vendor: [
        ...common,
        {
          name: 'DisplayName',
          label: 'Display Name',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: false,
        },
        {
          name: 'PrimaryEmailAddr',
          label: 'Email',
          type: 'string',
          filterable: true,
          sortable: false,
          nillable: true,
        },
        {
          name: 'Balance',
          label: 'Balance',
          type: 'decimal',
          filterable: true,
          sortable: true,
          nillable: true,
        },
      ],
    };

    return fieldsByObject[objectName] ?? common;
  }
}
