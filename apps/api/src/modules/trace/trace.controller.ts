import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  UseGuards,
  Inject,
  BadRequestException,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@nexiom/auth';
import { TraceService } from './trace.service.js';

@Controller('stitches/:stitchId/traces')
@UseGuards(AuthGuard)
export class TraceController {
  constructor(
    @Inject(TraceService) private readonly traceService: TraceService,
  ) {}

  /**
   * GET /stitches/:stitchId/traces?limit=50&cursor=<iso-timestamp>
   *
   * Returns a paginated list of sync_log summaries for a stitch (newest first).
   * Pass the returned `nextCursor` value as `cursor` to fetch the next page.
   */
  @Get()
  async listTraces(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    const orgId = ctx.user?.organizationId;
    if (!orgId) {
      throw new BadRequestException('Organization context is missing');
    }

    return this.traceService.listTraces(orgId, stitchId, limit, cursor);
  }

  /**
   * GET /stitches/:stitchId/traces/:traceId
   *
   * Returns the full trace — all sync_log layer entries joined with the
   * actual L1/L2/L3/L5–L6 data rows for that traceId.
   */
  @Get(':traceId')
  async getTrace(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Param('traceId', ParseUUIDPipe) traceId: string,
  ) {
    const orgId = ctx.user?.organizationId;
    if (!orgId) {
      throw new BadRequestException('Organization context is missing');
    }

    return this.traceService.getTrace(orgId, stitchId, traceId);
  }
}
