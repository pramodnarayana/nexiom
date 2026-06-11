import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  PermissionsGuard,
  RequirePermission,
  AuthContext,
  type RequestAuthContext,
} from '@soopa/auth';
import {
  UpsertFieldMappingBody,
  BulkUpsertAndDeleteBody,
} from './field-mappings.validation.js';
import { UpsertFieldMappingUseCase } from './core/use-cases/field-mappings/upsert-field-mapping.use-case.js';
import { DeleteFieldMappingUseCase } from './core/use-cases/field-mappings/delete-field-mapping.use-case.js';
import { BulkUpsertAndDeleteFieldMappingsUseCase } from './core/use-cases/field-mappings/bulk-upsert-and-delete-field-mappings.use-case.js';
import { requireOrgId } from '../workspaces/workspace.utils.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('stitches/:stitchId/mappings')
export class FieldMappingsController {
  constructor(
    private readonly upsertFieldMappingUseCase: UpsertFieldMappingUseCase,
    private readonly deleteFieldMappingUseCase: DeleteFieldMappingUseCase,
    private readonly bulkUpsertAndDeleteFieldMappingsUseCase: BulkUpsertAndDeleteFieldMappingsUseCase,
  ) {}

  /** Upsert a field-mapping template for a given canonical type on a stitch. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stitches', 'manage')
  upsert(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Body() body: UpsertFieldMappingBody,
  ) {
    return this.upsertFieldMappingUseCase.execute(
      requireOrgId(auth),
      stitchId,
      body,
    );
  }

  /** Alias for POST — PATCH upserts the same way for idempotent client calls. */
  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stitches', 'manage')
  update(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Body() body: UpsertFieldMappingBody,
  ) {
    return this.upsertFieldMappingUseCase.execute(
      requireOrgId(auth),
      stitchId,
      body,
    );
  }

  /**
   * DELETE /stitches/:stitchId/mappings/:sourceCanonical
   * Returns 204 No Content. Idempotent — no error if mapping is absent.
   */
  @Delete(':sourceCanonical')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('stitches', 'manage')
  async remove(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Param('sourceCanonical') sourceCanonical: string,
  ) {
    await this.deleteFieldMappingUseCase.execute(
      requireOrgId(auth),
      stitchId,
      sourceCanonical,
    );
  }

  /**
   * POST /stitches/:stitchId/mappings/bulk
   * Atomically performs upserts and deletes. Returns array of upserted mappings.
   */
  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('stitches', 'manage')
  bulkUpsertAndDelete(
    @AuthContext() auth: RequestAuthContext,
    @Param('stitchId', ParseUUIDPipe) stitchId: string,
    @Body() body: BulkUpsertAndDeleteBody,
  ) {
    return this.bulkUpsertAndDeleteFieldMappingsUseCase.execute(
      requireOrgId(auth),
      stitchId,
      body,
    );
  }
}
