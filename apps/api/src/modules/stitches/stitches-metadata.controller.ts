import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  BadRequestException,
  PipeTransform,
  Injectable,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import { MetadataDiscoveryService } from '@soopa/piece-registry';
import { requireOrgId } from '../workspaces/workspace.utils.js';

/**
 * Pipe that validates objectName path parameters to prevent cache poisoning
 * and malformed connector calls. Enforces a whitelist pattern: alphanumeric,
 * underscore, dot, and hyphen characters only, with a maximum length of 256.
 */
@Injectable()
export class ValidateObjectNamePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!value || typeof value !== 'string') {
      throw new BadRequestException('Object name is required.');
    }
    // Whitelist: alphanumeric, underscore, dot, hyphen; max 256 chars.
    if (!/^[A-Za-z0-9_.-]{1,256}$/.test(value)) {
      throw new BadRequestException(
        'Invalid object name. Only alphanumeric characters, underscores, dots, and hyphens are allowed (max 256 characters).',
      );
    }
    return value;
  }
}

/**
 * Exposes MetadataDiscoveryService over HTTP so the stitch-creation wizard
 * can discover objects, fields, related objects, and connector config for a
 * given connection.
 *
 * Route prefix: /stitches/metadata/:dataSourceId/*
 *
 * All routes require the `stitches:read` permission so they are accessible
 * to any user who can view stitches (including users building new ones).
 */
@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches/metadata')
export class StitchesMetadataController {
  constructor(private readonly metadataDiscovery: MetadataDiscoveryService) {}

  /**
   * GET /stitches/metadata/:dataSourceId/objects
   * Returns the list of queryable objects exposed by the connector.
   *
   * Query params:
   *   refresh=true  — bypass Redis + DB cache and force a live fetch.
   */
  @Get(':dataSourceId/objects')
  @RequirePermission('stitches', 'read')
  listObjects(
    @AuthContext() auth: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.metadataDiscovery.describeObjects(
      requireOrgId(auth),
      dataSourceId,
      undefined, // use configured max
      refresh === 'true',
    );
  }

  /**
   * GET /stitches/metadata/:dataSourceId/objects/:objectName/fields
   * Returns the field descriptors for the given object.
   *
   * Query params:
   *   refresh=true  — bypass Redis + DB cache and force a live fetch from the connector.
   */
  @Get(':dataSourceId/objects/:objectName/fields')
  @RequirePermission('stitches', 'read')
  listFields(
    @AuthContext() auth: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Param('objectName', ValidateObjectNamePipe) objectName: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.metadataDiscovery.describeFields(
      requireOrgId(auth),
      dataSourceId,
      objectName, // Validated by ValidateObjectNamePipe
      refresh === 'true',
    );
  }

  /**
   * GET /stitches/metadata/:dataSourceId/objects/:objectName/related
   * Returns the related-object descriptors for the given object (1:1 / 1:N).
   * Returns an empty array for connectors that do not implement describeRelatedObjects.
   */
  @Get(':dataSourceId/objects/:objectName/related')
  @RequirePermission('stitches', 'read')
  listRelatedObjects(
    @AuthContext() auth: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Param('objectName', ValidateObjectNamePipe) objectName: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.metadataDiscovery.describeRelatedObjects(
      requireOrgId(auth),
      dataSourceId,
      objectName, // Validated by ValidateObjectNamePipe
      refresh === 'true',
    );
  }

  /**
   * GET /stitches/metadata/:dataSourceId/config
   * Returns the connector-level configuration options (sync config knobs).
   * Returns an empty array for connectors that do not implement describeConfig.
   */
  @Get(':dataSourceId/config')
  @RequirePermission('stitches', 'read')
  describeConfig(
    @AuthContext() auth: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
  ) {
    return this.metadataDiscovery.describeConfig(
      requireOrgId(auth),
      dataSourceId,
    );
  }

  /**
   * GET /stitches/metadata/:dataSourceId/objects/:objectName/count
   * Returns the total record count for the given object.
   * Returns null if the connector does not support counting.
   */
  @Get(':dataSourceId/objects/:objectName/count')
  @RequirePermission('stitches', 'read')
  async countRecords(
    @AuthContext() auth: RequestAuthContext,
    @Param('dataSourceId', ParseUUIDPipe) dataSourceId: string,
    @Param('objectName', ValidateObjectNamePipe) objectName: string,
  ) {
    const count = await this.metadataDiscovery.countRecords(
      requireOrgId(auth),
      dataSourceId,
      objectName,
    );
    return { count };
  }
}
