import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type {
  TraceRepositoryPort,
  TraceListResult,
} from '../../ports/outbound/trace-repository.port.js';
import type { TraceStorageResolverPort } from '../../ports/outbound/trace-storage-resolver.port.js';
import {
  DATABASE_CONNECTION,
  type DrizzleDb,
  integrationStitches,
} from '@soopa/database';
import { eq, and } from 'drizzle-orm';

interface ParsedCursor {
  timestamp: Date;
  id: string;
}

function parseCursor(cursor: string): ParsedCursor {
  const separatorIdx = cursor.lastIndexOf(':');
  if (separatorIdx === -1) {
    throw new BadRequestException(
      'Invalid cursor format — expected "<timestamp>:<id>"',
    );
  }
  const ts = cursor.slice(0, separatorIdx);
  const id = cursor.slice(separatorIdx + 1);

  const timestamp = new Date(ts);
  if (Number.isNaN(timestamp.getTime())) {
    throw new BadRequestException(
      'Invalid cursor: timestamp component is not a valid date',
    );
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    throw new BadRequestException(
      'Invalid cursor: id component is not a valid UUID',
    );
  }

  return { timestamp, id };
}

@Injectable()
export class ListTracesUseCase {
  constructor(
    @Inject('TRACE_REPOSITORY_PORT')
    private readonly traceRepo: TraceRepositoryPort,
    @Inject('TRACE_STORAGE_RESOLVER_PORT')
    private readonly storageResolver: TraceStorageResolverPort,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async execute(
    orgId: string,
    stitchId: string,
    workspaceId: string | undefined,
    limit: number,
    cursor?: string,
  ): Promise<TraceListResult> {
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

    const srcSchemaNameRaw = await this.storageResolver.resolveSchemaName(
      stitch.destDataSourceId,
    );

    const srcDataSourceId =
      await this.traceRepo.resolveSourceConnectionForStitch(
        orgId,
        stitchId,
        stitch.destDataSourceId,
        srcSchemaNameRaw,
      );

    const srcSchemaName =
      await this.storageResolver.resolveSchemaName(srcDataSourceId);

    let cursorTs: Date | undefined;
    let cursorId: string | undefined;

    if (cursor) {
      const parsed = parseCursor(cursor);
      cursorTs = parsed.timestamp;
      cursorId = parsed.id;
    }

    return this.traceRepo.listTraces(
      orgId,
      stitchId,
      workspaceId,
      srcSchemaName,
      limit,
      cursorTs,
      cursorId,
    );
  }
}
