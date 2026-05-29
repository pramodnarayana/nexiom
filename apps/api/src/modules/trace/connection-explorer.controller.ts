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
import { AuthContext, type RequestAuthContext, AuthGuard } from '@nexiom/auth';
import { DataExplorerService } from './data-explorer.service.js';
import { validateFilterGroup } from './filter-parser.js';

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
  constructor(private readonly explorer: DataExplorerService) {}

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
    @Query('filters') filters?: string,
    @Query('objectType') objectType?: string,
  ) {
    if (!ALLOWED_TABS.includes(tab as TabName)) {
      throw new NotFoundException(`Tab "${tab}" not found`);
    }

    let parsedFilters: import('./filter-parser.js').FilterGroup | undefined =
      undefined;
    if (filters) {
      try {
        parsedFilters = JSON.parse(
          filters,
        ) as import('./filter-parser.js').FilterGroup;
        if (!validateFilterGroup(parsedFilters)) {
          throw new BadRequestException('Invalid filters format');
        }
      } catch (_e) {
        throw new BadRequestException('Invalid filters format');
      }
    }

    const orgId = this.requireOrg(ctx);
    const dispatchMap: Record<TabName, () => Promise<unknown>> = {
      inbound: () =>
        this.explorer.listConnectionInbound(
          orgId,
          connectionId,
          page,
          limit,
          workspaceId,
          objectType,
          parsedFilters,
        ),
      replica: () =>
        this.explorer.listConnectionReplica(
          orgId,
          connectionId,
          page,
          limit,
          workspaceId,
          objectType,
          parsedFilters,
        ),
      normalized: () =>
        this.explorer.listConnectionNormalized(
          orgId,
          connectionId,
          page,
          limit,
          workspaceId,
          objectType,
          parsedFilters,
        ),
      'entity-map': () => {
        throw new BadRequestException(
          'Entity Map is not available in Connection Explorer',
        );
      },
      outbound: () =>
        this.explorer.listConnectionOutbound(
          orgId,
          connectionId,
          page,
          limit,
          workspaceId,
        ),
    };

    return dispatchMap[tab as TabName]();
  }

  @Get('traces/:traceId')
  async getConnectionTrace(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('traceId', ParseUUIDPipe) traceId: string,
  ) {
    const orgId = this.requireOrg(ctx);
    return this.explorer.getConnectionTrace(orgId, connectionId, traceId);
  }

  @Get('traces/:traceId/routes')
  async listTraceRoutes(
    @AuthContext() ctx: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('traceId', ParseUUIDPipe) traceId: string,
  ) {
    const orgId = this.requireOrg(ctx);
    return this.explorer.listTraceRoutes(orgId, connectionId, traceId);
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
    return this.explorer.listObjectsByConnection(
      orgId,
      connectionId,
      tab,
      workspaceId,
    );
  }
}
