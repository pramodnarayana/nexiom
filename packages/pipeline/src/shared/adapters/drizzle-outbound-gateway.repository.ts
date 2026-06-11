import { Injectable, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DB_MANAGER, type DatabaseManager } from "@soopa/dbmanager";
import { assertValidSchemaName } from "@soopa/database";
import { OutboundGatewayRepositoryPort } from "../../shared/ports/outbound-gateway.repository.port.js";

@Injectable()
export class DrizzleOutboundGatewayRepositoryAdapter implements OutboundGatewayRepositoryPort {
  constructor(
    @Inject(DB_MANAGER) private readonly dbManager: DatabaseManager,
  ) {}

  async upsertPendingOutboundGateway(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string,
    destDataSourceId: string,
    sourceDataSourceId: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    let shouldPublish = false;

    await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const result = await destTx.execute<{ status: string }>(sql`
        INSERT INTO outbound_gateway (trace_id, route_id, data_source_id, src_data_source_id, payload, status, attempts, created_at, updated_at)
        VALUES (${traceId}, ${routeId}, ${destDataSourceId}, ${sourceDataSourceId}, ${JSON.stringify(payload)}, 'PENDING', 0, NOW(), NOW())
        ON CONFLICT (trace_id, route_id)
        DO UPDATE SET
          payload = ${JSON.stringify(payload)},
          status = 'PENDING',
          attempts = 0,
          updated_at = NOW()
        WHERE outbound_gateway.status IN ('DEFERRED_DEPENDENCY', 'FAILED', 'PENDING')
          OR outbound_gateway.status IS NULL
        RETURNING status, (xmax = 0) as was_insert
      `);

      if (result.rows.length > 0) {
        shouldPublish = true;
      }
    });

    return shouldPublish;
  }

  async upsertDeferredOutboundGateway(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string,
    destDataSourceId: string,
    sourceDataSourceId: string
  ): Promise<boolean> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    let shouldPublishActiveFetch = false;

    await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const result = await destTx.execute<{ status: string }>(sql`
        INSERT INTO outbound_gateway (trace_id, route_id, data_source_id, src_data_source_id, payload, status, attempts, created_at, updated_at)
        VALUES (${traceId}, ${routeId}, ${destDataSourceId}, ${sourceDataSourceId}, ${JSON.stringify({})}, 'DEFERRED_DEPENDENCY', 0, NOW(), NOW())
        ON CONFLICT (trace_id, route_id)
        DO UPDATE SET
          status = 'DEFERRED_DEPENDENCY',
          payload = ${JSON.stringify({})},
          updated_at = NOW()
        WHERE outbound_gateway.status NOT IN ('DEFERRED_DEPENDENCY', 'PENDING', 'SUCCESS')
          OR outbound_gateway.status IS NULL
        RETURNING status
      `);

      if (result.rows.length > 0) {
        shouldPublishActiveFetch = true;
      }
    });

    return shouldPublishActiveFetch;
  }

  async markOutboundGatewayFailed(
    tenantId: string,
    destSchemaName: string,
    traceId: string,
    routeId: string
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    
    await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );
      await destTx.execute(sql`
        UPDATE outbound_gateway
        SET status = 'FAILED', updated_at = NOW()
        WHERE trace_id = ${traceId} AND route_id = ${routeId}
      `);
    });
  }

  async insertOrFetchPending(
    tenantId: string,
    destSchemaName: string,
    data: {
      traceId: string;
      routeId: string;
      dataSourceId: string;
      srcDataSourceId: string;
      payload: Record<string, unknown>;
    }
  ): Promise<{ id: string; status: string; attempts: number }> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);
    
    return await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const result = await destTx.execute<{
        id: string;
        status: string;
        attempts: number;
      }>(sql`
        INSERT INTO outbound_gateway (trace_id, route_id, data_source_id, src_data_source_id, payload, status, attempts, created_at, updated_at)
        VALUES (${data.traceId}, ${data.routeId}, ${data.dataSourceId}, ${data.srcDataSourceId}, ${JSON.stringify(data.payload)}, 'PENDING', 0, NOW(), NOW())
        ON CONFLICT (trace_id, route_id)
        DO UPDATE SET
          status = CASE WHEN outbound_gateway.status IN ('DEFERRED_DEPENDENCY', 'FAILED') THEN 'PENDING' ELSE outbound_gateway.status END,
          payload = CASE WHEN outbound_gateway.status IN ('DEFERRED_DEPENDENCY', 'FAILED') THEN ${JSON.stringify(data.payload)} ELSE outbound_gateway.payload END,
          updated_at = NOW()
        RETURNING id, status, attempts
      `);

      return result.rows[0];
    });
  }

  async claimForProcessing(
    tenantId: string,
    destSchemaName: string,
    id: string
  ): Promise<{ claimed: boolean; attemptCount: number }> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    return await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const claimResult = await destTx.execute<{ attempts: number }>(sql`
        UPDATE outbound_gateway
        SET status = 'PROCESSING',
            attempts = attempts + 1,
            updated_at = NOW()
        WHERE id = ${id} AND status IN ('PENDING', 'RETRY')
        RETURNING attempts
      `);

      if (claimResult.rows.length === 0) {
        return { claimed: false, attemptCount: 0 };
      }

      return { claimed: true, attemptCount: claimResult.rows[0].attempts };
    });
  }

  async markResult(
    tenantId: string,
    destSchemaName: string,
    outboundGatewayId: string,
    attemptCount: number,
    status: "SUCCESS" | "FAIL" | "RETRY",
    statusCode: number,
    responsePayload: Record<string, unknown> | null,
    sentPayload: Record<string, unknown> | null,
    destVendorId?: string,
    replicaUpdate?: {
      traceId: string;
      dataSourceId: string;
      targetObject: string;
    }
  ): Promise<void> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      await destTx.execute(sql`
        UPDATE outbound_gateway
        SET status = ${status},
            status_code = ${statusCode},
            response = ${responsePayload ? JSON.stringify(responsePayload) : null},
            dest_vendor_id = ${destVendorId ?? null},
            updated_at = NOW()
        WHERE id = ${outboundGatewayId} AND attempts = ${attemptCount}
      `);

      if (replicaUpdate && destVendorId && status === "SUCCESS") {
        await destTx.execute(sql`
          INSERT INTO replica_entity (trace_id, data_source_id, entity_type, entity_id, data, created_at, updated_at)
          VALUES (${replicaUpdate.traceId}, ${replicaUpdate.dataSourceId}, ${replicaUpdate.targetObject}, ${destVendorId}, ${sentPayload ? JSON.stringify(sentPayload) : null}, NOW(), NOW())
          ON CONFLICT (data_source_id, entity_type, entity_id)
          DO UPDATE SET
            data = ${sentPayload ? JSON.stringify(sentPayload) : null},
            trace_id = ${replicaUpdate.traceId},
            updated_at = NOW()
        `);
      }
    });
  }

  async fetchOutboundGatewayResult(
    tenantId: string,
    destSchemaName: string,
    outboundGatewayId: string
  ): Promise<{
    attempts: number;
    statusCode: number | null;
    response: Record<string, unknown> | null;
    destVendorId: string | null;
  } | null> {
    const tenantDb = await this.dbManager.getTenantDb(tenantId);

    return await tenantDb.transaction(async (destTx) => {
      assertValidSchemaName(destSchemaName);
      await destTx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + destSchemaName + '"')}`,
      );

      const result = await destTx.execute<{
        attempts: number;
        status_code: number | null;
        response: Record<string, unknown> | null;
        dest_vendor_id: string | null;
      }>(sql`
        SELECT attempts, status_code, response, dest_vendor_id
        FROM outbound_gateway
        WHERE id = ${outboundGatewayId}
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return null;
      }

      return {
        attempts: result.rows[0].attempts,
        statusCode: result.rows[0].status_code,
        response: result.rows[0].response,
        destVendorId: result.rows[0].dest_vendor_id,
      };
    });
  }
}
