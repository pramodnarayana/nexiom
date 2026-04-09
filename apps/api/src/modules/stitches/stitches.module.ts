import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { CacheModule } from '@nexiom/cache';
import { EncryptionService, AesEncryptionService } from '@nexiom/credentials';
import { DbModule } from '../../db/db.module.js';
import { PiecesModule } from '@nexiom/piece-registry';
import { ConnectionsModule } from '../connections/connections.module.js';
import { StitchesController } from './stitches.controller.js';
import { StitchesAdminController } from './stitches-admin.controller.js';
import { FieldMappingsController } from './field-mappings.controller.js';
import { StitchesService } from './stitches.service.js';
import { MetadataModule } from '@nexiom/piece-registry';

@Module({
  imports: [
    DbModule,
    AuthModule,
    CacheModule,
    PiecesModule,
    ConnectionsModule,
    MetadataModule,
  ],
  controllers: [
    StitchesController,
    StitchesAdminController,
    FieldMappingsController,
  ],
  providers: [
    StitchesService,
    { provide: EncryptionService, useClass: AesEncryptionService },
  ],
  exports: [StitchesService],
})
export class StitchesModule {}
