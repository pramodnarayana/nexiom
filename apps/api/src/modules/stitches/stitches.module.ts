import { Module } from '@nestjs/common';
import { AuthModule } from '@soopa/auth';
import { CacheModule } from '@soopa/cache';
import { DatabaseModule } from '@soopa/database';
import { ConnectionsModule } from '../connections/connections.module.js';
import { StitchesController } from './stitches.controller.js';
import { StitchesMetadataController } from './stitches-metadata.controller.js';
import { CanonicalMetadataController } from './canonical-metadata.controller.js';
import { FieldMappingsController } from './field-mappings.controller.js';
import { MetadataModule } from '@soopa/piece-registry';
import { buildTmsSchema } from '@soopa/domain-tms';

// Adapters
import { DrizzleStitchRepositoryAdapter } from './adapters/outbound/drizzle-stitch.adapter.js';
import { DrizzleFieldMappingRepositoryAdapter } from './adapters/outbound/drizzle-field-mapping.adapter.js';
import { DrizzleCanonicalSchemaAdapter } from './adapters/outbound/drizzle-canonical-schema.adapter.js';

// Ports
import { STITCH_REPOSITORY_PORT } from './core/ports/outbound/stitch-repository.port.js';
import { FIELD_MAPPING_REPOSITORY_PORT } from './core/ports/outbound/field-mapping-repository.port.js';
import {
  CANONICAL_SCHEMA_REPOSITORY_PORT,
  CANONICAL_SCHEMA_PROVIDERS,
} from './core/ports/outbound/canonical-schema.repository.port.js';

// Use Cases
import { CreateStitchUseCase } from './core/use-cases/stitches/create-stitch.use-case.js';
import { UpdateStitchUseCase } from './core/use-cases/stitches/update-stitch.use-case.js';
import { ArchiveStitchUseCase } from './core/use-cases/stitches/archive-stitch.use-case.js';
import { ListStitchesUseCase } from './core/use-cases/stitches/list-stitches.use-case.js';
import { GetStitchUseCase } from './core/use-cases/stitches/get-stitch.use-case.js';

import { BulkUpsertAndDeleteFieldMappingsUseCase } from './core/use-cases/field-mappings/bulk-upsert-and-delete-field-mappings.use-case.js';
import { UpsertFieldMappingUseCase } from './core/use-cases/field-mappings/upsert-field-mapping.use-case.js';
import { DeleteFieldMappingUseCase } from './core/use-cases/field-mappings/delete-field-mapping.use-case.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    CacheModule,
    ConnectionsModule,
    MetadataModule,
  ],
  controllers: [
    StitchesController,
    StitchesMetadataController,
    CanonicalMetadataController,
    FieldMappingsController,
  ],
  providers: [
    {
      provide: CANONICAL_SCHEMA_PROVIDERS,
      useValue: [buildTmsSchema('ws_dummy_reflection')],
    },
    {
      provide: STITCH_REPOSITORY_PORT,
      useClass: DrizzleStitchRepositoryAdapter,
    },
    {
      provide: FIELD_MAPPING_REPOSITORY_PORT,
      useClass: DrizzleFieldMappingRepositoryAdapter,
    },
    {
      provide: CANONICAL_SCHEMA_REPOSITORY_PORT,
      useClass: DrizzleCanonicalSchemaAdapter,
    },
    CreateStitchUseCase,
    UpdateStitchUseCase,
    ArchiveStitchUseCase,
    ListStitchesUseCase,
    GetStitchUseCase,
    BulkUpsertAndDeleteFieldMappingsUseCase,
    UpsertFieldMappingUseCase,
    DeleteFieldMappingUseCase,
  ],
  exports: [
    CreateStitchUseCase,
    UpdateStitchUseCase,
    ArchiveStitchUseCase,
    ListStitchesUseCase,
    GetStitchUseCase,
    BulkUpsertAndDeleteFieldMappingsUseCase,
    UpsertFieldMappingUseCase,
    DeleteFieldMappingUseCase,
  ],
})
export class StitchesModule {}
