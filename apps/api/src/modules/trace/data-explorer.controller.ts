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

const ALLOWED_TABS = [
  'inbound',
  'replica',
  'normalized',
  'entity-map',
  'outbound',
] as const;
type TabName = (typeof ALLOWED_TABS)[number];

@Controller('stitches/:stitchId/explorer')
@UseGuards(AuthGuard)
export class DataExplorerController {
  constructor(private readonly explorer: DataExplorerService) {}

  private requireOrg(ctx: RequestAuthContext): string {
    const orgId = ctx.user?.organizationId;
    if (!orgId)
      throw new BadRequestException('Organization context is missing');
    return orgId;
  }

  @Get(':tab')
  listByTab(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Param('tab') tab: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId', new ParseUUIDPipe({ optional: true }))
    workspaceId?: string,
  ) {
    if (!ALLOWED_TABS.includes(tab as TabName)) {
      throw new NotFoundException(`Tab "${tab}" not found`);
    }

    const orgId = this.requireOrg(ctx);
    const dispatchMap: Record<TabName, () => Promise<unknown>> = {
      inbound: () =>
        this.explorer.listInbound(orgId, stitchId, page, limit, workspaceId),
      replica: () =>
        this.explorer.listReplica(orgId, stitchId, page, limit, workspaceId),
      normalized: () =>
        this.explorer.listNormalized(orgId, stitchId, page, limit, workspaceId),
      'entity-map': () =>
        this.explorer.listEntityMap(orgId, stitchId, page, limit, workspaceId),
      outbound: () =>
        this.explorer.listOutbound(orgId, stitchId, page, limit, workspaceId),
    };

    return dispatchMap[tab as TabName]();
  }
}
