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
import { DataExplorerService } from './data-explorer.service.js';

@Controller('stitches/:stitchId/explorer')
@UseGuards(AuthGuard)
export class DataExplorerController {
  constructor(
    @Inject(DataExplorerService) private readonly explorer: DataExplorerService,
  ) {}

  private requireOrg(ctx: RequestAuthContext): string {
    const orgId = ctx.user?.organizationId;
    if (!orgId)
      throw new BadRequestException('Organization context is missing');
    return orgId;
  }

  @Get('inbound')
  listInbound(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.explorer.listInbound(
      this.requireOrg(ctx),
      stitchId,
      page,
      limit,
      workspaceId,
    );
  }

  @Get('replica')
  listReplica(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.explorer.listReplica(
      this.requireOrg(ctx),
      stitchId,
      page,
      limit,
      workspaceId,
    );
  }

  @Get('normalized')
  listNormalized(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.explorer.listNormalized(
      this.requireOrg(ctx),
      stitchId,
      page,
      limit,
      workspaceId,
    );
  }

  @Get('entity-map')
  listEntityMap(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.explorer.listEntityMap(
      this.requireOrg(ctx),
      stitchId,
      page,
      limit,
      workspaceId,
    );
  }

  @Get('outbound')
  listOutbound(
    @AuthContext() ctx: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.explorer.listOutbound(
      this.requireOrg(ctx),
      stitchId,
      page,
      limit,
      workspaceId,
    );
  }
}
