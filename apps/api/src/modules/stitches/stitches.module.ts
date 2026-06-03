import { Module } from '@nestjs/common';
import { AuthModule } from '@soopa/auth';
import { CacheModule } from '@soopa/cache';
import { EncryptionService, AesEncryptionService } from '@soopa/credentials';
import { DbModule } from '../../db/db.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { StitchesController } from './stitches.controller.js';

import { StitchesMetadataController } from './stitches-metadata.controller.js';
import { FieldMappingsController } from './field-mappings.controller.js';
import { StitchesService } from './stitches.service.js';
import { MetadataModule } from '@soopa/piece-registry';

@Module({
  imports: [
    DbModule,
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
    { provide: EncryptionService, useClass: AesEncryptionService },
  ],
  exports: [StitchesService],
})
export class StitchesModule {}
