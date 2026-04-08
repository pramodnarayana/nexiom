import {
  Controller,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  ParseBoolPipe,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@nexiom/auth';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';
import { requireOrgId } from '../workspaces/workspace.utils.js';

function validateObjectName(objectName: string) {
  if (!/^[\w]{1,255}$/.test(objectName)) {
    throw new BadRequestException(
      'objectName must be 1-255 alphanumeric/underscore characters.',
    );
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches/metadata')
export class MetadataController {
  constructor(private readonly metadataDiscovery: MetadataDiscoveryService) {}

  @Get(':connectionId/objects')
  @RequirePermission('stitches', 'read')
  describeObjects(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit: number,
    @Query('refresh', new DefaultValuePipe(false), ParseBoolPipe)
    refresh: boolean,
  ) {
    return this.metadataDiscovery.describeObjects(
      requireOrgId(auth),
      connectionId,
      limit,
      refresh,
    );
  }

  @Get(':connectionId/objects/:objectName/fields')
  @RequirePermission('stitches', 'read')
  describeFields(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('objectName') objectName: string,
  ) {
    // Restrict to safe characters: vendor object names are alphanumeric + underscore.
    // Prevents Redis key injection and ensures URL-safe values.
    validateObjectName(objectName);
    return this.metadataDiscovery.describeFields(
      requireOrgId(auth),
      connectionId,
      objectName,
    );
  }

  @Get(':connectionId/objects/:objectName/related')
  @RequirePermission('stitches', 'read')
  describeRelatedObjects(
    @AuthContext() auth: RequestAuthContext,
    @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Param('objectName') objectName: string,
  ) {
    validateObjectName(objectName);
    return this.metadataDiscovery.describeRelatedObjects(
      requireOrgId(auth),
      connectionId,
      objectName,
    );
  }

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
