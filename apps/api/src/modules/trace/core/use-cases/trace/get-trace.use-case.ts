import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type {
  TraceRepositoryPort,
  FullTrace,
} from '../../ports/outbound/trace-repository.port.js';
import type { TraceStorageResolverPort } from '../../ports/outbound/trace-storage-resolver.port.js';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
} from '@soopa/database';
import { eq, and } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class GetTraceUseCase {
  constructor(
    private readonly logger: PinoLogger,
    @Inject('TRACE_REPOSITORY_PORT')
    private readonly traceRepo: TraceRepositoryPort,
    @Inject('TRACE_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TraceStorageResolverPort,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {
    this.logger.setContext(GetTraceUseCase.name);
  }

  async execute(
    orgId: string,
    stitchId: string,
    traceId: string,
    workspaceId: string | undefined,
  ): Promise<FullTrace> {
    const stitch = await this.db.query.integrationStitches.findFirst({
      where: workspaceId
        ? and(
            eq(integrationStitches.id, stitchId),
            eq(integrationStitches.orgId, orgId),
            eq(integrationStitches.workspaceId, workspaceId),
          )
        : and(
            eq(integrationStitches.id, stitchId),
            eq(integrationStitches.orgId, orgId),
          ),
      columns: { id: true, destDataSourceId: true },
    });

    if (!stitch) {
      throw new NotFoundException(`Stitch ${stitchId} not found`);
    }

    const destSchemaNameRaw = await this.storageResolver.resolveSchemaName(
      stitch.destDataSourceId,
    );

    const srcDataSourceId =
      await this.traceRepo.resolveSourceConnectionForStitch(
        orgId,
        stitchId,
        stitch.destDataSourceId,
        destSchemaNameRaw,
      );

    const srcSchemaName =
      await this.storageResolver.resolveSchemaName(srcDataSourceId);

    const trace = await this.traceRepo.getTrace(
      stitchId,
      traceId,
      srcDataSourceId,
      srcSchemaName,
      destSchemaNameRaw,
    );

    this.logger.debug(
      { stitchId, traceId, layerCount: trace.layers.length },
      'trace.get',
    );

    return trace;
  }
}
