import { Module } from '@nestjs/common';
import { AuthModule } from '@soopa/auth';
import { CacheModule } from '@soopa/cache';
import { EncryptionService, AesEncryptionService } from '@soopa/credentials';
import { DatabaseModule } from '@soopa/database';
import { ConnectionsModule } from '../connections/connections.module.js';
import { StitchesController } from './stitches.controller.js';
import { StitchesMetadataController } from './stitches-metadata.controller.js';
import { FieldMappingsController } from './field-mappings.controller.js';
import { FieldMappingsRepository } from './repositories/field-mappings.repository.js';
import { StitchesService } from './stitches.service.js';
import { MetadataModule } from '@soopa/piece-registry';

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
    FieldMappingsController,
  ],
  providers: [
    StitchesService,
    FieldMappingsRepository,
    { provide: EncryptionService, useClass: AesEncryptionService },
  ],
  exports: [StitchesService, FieldMappingsRepository],
})
export class StitchesModule {}
