import { Module, Global } from '@nestjs/common';
import {
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
} from '@nexiom/credentials';
import { DbModule } from '../../db/db.module.js';
import { REDIS_CLIENT } from '@nexiom/cache';
import type { Redis } from '@nexiom/cache';
import { OAuthCallbackController } from './connections/callback.controller.js';
import { ConnectorsController } from './connections/connectors.controller.js';
import { DefaultOAuthRefreshClient } from './connections/token-refresh.service.js';
import { ConnectorsService } from './connectors.service.js';
import { OauthStateService } from './oauth-state.service.js';
import { PiecesModule } from '@nexiom/piece-registry';

import { DATABASE_CONNECTION } from '@nexiom/database';
import { type DrizzleDb } from '@nexiom/database';

/**
 * Handles OAuth connectivity, credential storage, and token management.
 * Redis is provided globally by CacheModule (imported in AppModule).
 *
 * NOTE: Do NOT implement OnModuleDestroy here to call redis.quit()/disconnect().
 * The CacheModule's RedisLifecycleService owns the connection lifecycle and will
 * close the socket on shutdown — closing it a second time would cause errors.
 */
@Global()
@Module({
  imports: [DbModule, PiecesModule],
  controllers: [OAuthCallbackController, ConnectorsController],
  providers: [
    {
      provide: TokenManagerService,
      useFactory: (
        db: DrizzleDb,
        redis: Redis,
        crypto: EncryptionService,
        refreshClient: OAuthRefreshClient,
      ) => {
        return new TokenManagerService(db, redis, crypto, refreshClient);
      },
      inject: [
        DATABASE_CONNECTION,
        REDIS_CLIENT,
        EncryptionService,
        OAuthRefreshClient,
      ],
    },
    ConnectorsService,
    OauthStateService,
    { provide: EncryptionService, useClass: AesEncryptionService },
    { provide: OAuthRefreshClient, useClass: DefaultOAuthRefreshClient },
  ],
  exports: [TokenManagerService],
})
export class ConnectionsModule {}
