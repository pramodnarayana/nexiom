import { Controller, Get, Param, UseGuards, Inject } from '@nestjs/common';
import { AuthGuard, PermissionsGuard, RequirePermission } from '@soopa/auth';
import {
  CANONICAL_SCHEMA_REPOSITORY_PORT,
  type CanonicalSchemaRepositoryPort,
} from './core/ports/outbound/canonical-schema.repository.port.js';

/**
 * Controller for serving Canonical Hub Entities schema.
 * This ensures that when configuring the "Source" of a Stitch, the UI
 * loads the Hub schema (e.g. TMS_CARRIER) instead of querying the external connection.
 */
@Controller('stitches/canonical')
@UseGuards(AuthGuard, PermissionsGuard)
export class CanonicalMetadataController {
  constructor(
    @Inject(CANONICAL_SCHEMA_REPOSITORY_PORT)
    private readonly canonicalRegistry: CanonicalSchemaRepositoryPort,
  ) {}

  @Get('objects')
  @RequirePermission('stitches', 'read')
  async listObjects() {
    return this.canonicalRegistry.listObjects();
  }

  @Get('objects/:objectName/fields')
  @RequirePermission('stitches', 'read')
  async listFields(@Param('objectName') objectName: string) {
    const fields = await this.canonicalRegistry.listFields(objectName);
    if (!fields || fields.length === 0) {
      // Fallback
      return [
        {
          name: 'id',
          label: 'Hub ID',
          type: 'string',
          filterable: true,
          sortable: true,
          nillable: false,
        },
      ];
    }
    return fields;
  }
}
