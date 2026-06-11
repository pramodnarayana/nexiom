import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  UseGuards,
  BadRequestException,
  DefaultValuePipe,
  NotFoundException,
} from '@nestjs/common';
import { AuthContext, type RequestAuthContext, AuthGuard } from '@soopa/auth';
import { validateFilterGroup } from './filter-parser.js';
import { ListConnectionDataUseCase } from './core/use-cases/explorer/list-connection-data.use-case.js';
import { GetConnectionTraceUseCase } from './core/use-cases/explorer/get-connection-trace.use-case.js';
import { ListTraceRoutesUseCase } from './core/use-cases/explorer/list-trace-routes.use-case.js';
import { ListObjectsUseCase } from './core/use-cases/explorer/list-objects.use-case.js';

const ALLOWED_TABS = [
  'inbound',
  'replica',
  'normalized',
  'entity-map',
  'outbound',
] as const;
type TabName = (typeof ALLOWED_TABS)[number];

@Controller('connections/:connectionId/explorer')
@UseGuards(AuthGuard)
export class ConnectionExplorerController {
  constructor(
    private readonly listDataUseCase: ListConnectionDataUseCase,
    private readonly getTraceUseCase: GetConnectionTraceUseCase,
    private readonly listRoutesUseCase: ListTraceRoutesUseCase,
    private readonly listObjectsUseCase: ListObjectsUseCase,
  ) {}

  private requireOrg(ctx: RequestAuthContext): string {
    const orgId = ctx.user?.organizationId;
    if (!orgId)
      throw new BadRequestException('Organization context is missing');
    return orgId;
  }

  @Get(':tab')
  async listByTab(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('tab') tab: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId', new ParseUUIDPipe({ optional: true }))
    workspaceId?: string,
    @Query('filters') filtersRaw?: string,
    @Query('objectType') objectType?: string,
  ) {
    if (!ALLOWED_TABS.includes(tab as TabName)) {
      throw new BadRequestException(`Invalid tab: ${tab}`);
    }

    let parsedFilters: import('./filter-parser.js').FilterGroup | undefined =
      undefined;
    if (filtersRaw) {
      try {
        parsedFilters = JSON.parse(
          filtersRaw,
        ) as import('./filter-parser.js').FilterGroup;
        if (!validateFilterGroup(parsedFilters)) {
          throw new BadRequestException('Invalid filters format');
        }
      } catch (_e) {
        throw new BadRequestException('Invalid filters format');
      }
    }

    const orgId = this.requireOrg(ctx);
    return this.listDataUseCase.execute(
      orgId,
      connectionId,
      tab as TabName,
      page,
      limit,
      workspaceId,
      objectType,
      parsedFilters,
    );
  }

  @Get('traces/:traceId')
  async getConnectionTrace(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('traceId', ParseUUIDPipe) traceId: string,
  ) {
    const orgId = this.requireOrg(ctx);
    return this.getTraceUseCase.execute(orgId, connectionId, traceId);
  }

  @Get('traces/:traceId/routes')
  async listTraceRoutes(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('traceId', ParseUUIDPipe) traceId: string,
  ) {
    const orgId = this.requireOrg(ctx);
    return this.listRoutesUseCase.execute(orgId, connectionId, traceId);
  }

  @Get(':tab/objects')
  async listObjectsByConnection(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('tab') tab: string,
    @Query('workspaceId', new ParseUUIDPipe({ optional: true }))
    workspaceId?: string,
  ) {
    if (!ALLOWED_TABS.includes(tab as TabName)) {
      throw new NotFoundException(`Tab "${tab}" not found`);
    }
    const orgId = this.requireOrg(ctx);
    return this.listObjectsUseCase.execute(
      orgId,
      connectionId,
      tab,
      workspaceId,
    );
  }
}
