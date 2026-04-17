import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@nexiom/auth';
import { MetadataDiscoveryService } from '@nexiom/piece-registry';
import { requireOrgId } from '../workspaces/workspace.utils.js';

/**
 * Exposes MetadataDiscoveryService over HTTP so the stitch-creation wizard
 * can discover objects, fields, related objects, and connector config for a
 * given connection.
 *
 * Route prefix: /stitches/metadata/:connectionId/*
 *
 * All routes require the `stitches:read` permission so they are accessible
 * to any user who can view stitches (including users building new ones).
 */
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches/metadata')
export class StitchesMetadataController {
  constructor(private readonly metadataDiscovery: MetadataDiscoveryService) {}

  /**
   * GET /stitches/metadata/:connectionId/objects
   * Returns the list of queryable objects exposed by the connector.
   *
   * Query params:
   *   refresh=true  — bypass Redis + DB cache and force a live fetch.
   */
  @Get(':connectionId/objects')
  @RequirePermission('stitches', 'read')
  listObjects(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.metadataDiscovery.describeObjects(
      requireOrgId(auth),
      connectionId,
      undefined, // use configured max
      refresh === 'true',
    );
  }

  /**
   * GET /stitches/metadata/:connectionId/objects/:objectName/fields
   * Returns the field descriptors for the given object.
   *
   * Query params:
   *   refresh=true  — bypass Redis + DB cache and force a live fetch from the connector.
   */
  @Get(':connectionId/objects/:objectName/fields')
  @RequirePermission('stitches', 'read')
  listFields(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('objectName') objectName: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.metadataDiscovery.describeFields(
      requireOrgId(auth),
      connectionId,
      objectName, // NestJS already URL-decodes path params
      refresh === 'true',
    );
  }

  /**
   * GET /stitches/metadata/:connectionId/objects/:objectName/related
   * Returns the related-object descriptors for the given object (1:1 / 1:N).
   * Returns an empty array for connectors that do not implement describeRelatedObjects.
   */
  @Get(':connectionId/objects/:objectName/related')
  @RequirePermission('stitches', 'read')
  listRelatedObjects(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('objectName') objectName: string,
  ) {
    return this.metadataDiscovery.describeRelatedObjects(
      requireOrgId(auth),
      connectionId,
      objectName, // NestJS already URL-decodes path params
    );
  }

  /**
   * GET /stitches/metadata/:connectionId/config
   * Returns the connector-level configuration options (sync config knobs).
   * Returns an empty array for connectors that do not implement describeConfig.
   */
  @Get(':connectionId/config')
  @RequirePermission('stitches', 'read')
  describeConfig(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.metadataDiscovery.describeConfig(
      requireOrgId(auth),
      connectionId,
    );
  }
}
