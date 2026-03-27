import { Module } from '@nestjs/common';
import { AuthModule } from '@nexiom/auth';
import { CacheModule } from '@nexiom/cache';
import { EncryptionService, AesEncryptionService } from '@nexiom/connectors';
import { DbModule } from '../../db/db.module.js';
import { PiecesModule } from '@nexiom/engine';
import { ConnectionsModule } from '../connections/connections.module.js';
import { StitchesController } from './stitches.controller.js';
import { StitchesAdminController } from './stitches-admin.controller.js';
import { MetadataController } from './metadata.controller.js';
import { FieldMappingsController } from './field-mappings.controller.js';
import { StitchesService } from './stitches.service.js';
import { MetadataDiscoveryService } from './metadata-discovery.service.js';

@Module({
  imports: [
    DbModule,
    AuthModule,
    CacheModule,
    PiecesModule.forRoot({ anchorUrl: import.meta.url }),
    ConnectionsModule,
  ],
  controllers: [
    StitchesController,
    StitchesAdminController,
    MetadataController,
    FieldMappingsController,
  ],
  providers: [
    StitchesService,
    MetadataDiscoveryService,
    { provide: EncryptionService, useClass: AesEncryptionService },
  ],
  exports: [StitchesService],
})
export class StitchesModule {}
