import { Injectable, Inject } from '@nestjs/common';
import type {
  TriggerGatewayRepositoryPort,
  InsertGatewayRowParams,
} from '../../core/ports/outbound/trigger-gateway-repository.port.js';
import {
  DATABASE_CONNECTION,
  buildTenantSchema,
  assertValidSchemaName,
  dataSources,
} from '@soopa/database';
import type { DrizzleDb } from '@soopa/database';
import { sql, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

@Injectable()
export class DrizzleTriggerGatewayRepositoryAdapter implements TriggerGatewayRepositoryPort {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  async insertGatewayRow(
    schemaName: string,
    params: InsertGatewayRowParams,
  ): Promise<boolean> {
    assertValidSchemaName(schemaName);

    let didInsert = false;
    const { inboundGateway, inboundOutbox } = buildTenantSchema(schemaName);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SET LOCAL search_path TO ${sql.raw('"' + schemaName + '"')}`,
      );

      const result = await tx
        .insert(inboundGateway)
        .values({
          traceId: randomUUID(),
          dataSourceId: params.dataSourceId,
          extReqId: params.extReqId,
          objectType: params.objectType ?? null,
          request: params.payload,
        })
        .onConflictDoNothing({ target: inboundGateway.extReqId })
        .returning({ traceId: inboundGateway.traceId });

      if (result.length > 0) {
        await tx
          .insert(inboundOutbox)
          .values({
            traceId: result[0].traceId,
            dataSourceId: params.dataSourceId,
          })
          .onConflictDoNothing({
            target: [inboundOutbox.traceId, inboundOutbox.dataSourceId],
          });
        didInsert = true;
      }
    });

    return didInsert;
  }

  async updateSchemaPlan(
    dataSourceId: string,
    schemaPlan: string,
  ): Promise<void> {
    await this.db
      .update(dataSources)
      .set({ schemaPlan })
      .where(eq(dataSources.id, dataSourceId));
  }
}
