import { Module } from '@nestjs/common';
import {
  ProviderRegistryService,
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
} from '@nexiom/connections';
import { DbModule } from '../../db/db.module';
import { REDIS_CLIENT } from '@nexiom/cache';
import type { Redis } from '@nexiom/cache';
import { OAuthCallbackController } from './connections/callback.controller';
import { ConnectorsController } from './connections/connectors.controller';
import { DefaultOAuthRefreshClient } from './connections/token-refresh.service';
import { ConnectorsService } from './connectors.service';
import { OauthStateService } from './oauth-state.service';

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
@Module({
  imports: [DbModule],
  controllers: [OAuthCallbackController, ConnectorsController],
  providers: [
    ProviderRegistryService,
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
})
export class ConnectionsModule {}
