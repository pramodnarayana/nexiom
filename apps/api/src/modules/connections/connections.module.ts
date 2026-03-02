import { Module, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import {
  ProviderRegistryService,
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
} from '@nexiom/connections';
import { REDIS_CLIENT } from '@nexiom/cache';
import type { Redis } from '@nexiom/cache';
import { DbModule } from '../../db/db.module';
import { OAuthCallbackController } from './connections/callback.controller';
import { ConnectorsController } from './connections/connectors.controller';
import { DefaultOAuthRefreshClient } from './connections/token-refresh.service';
import { ConnectorsService } from './connectors.service';
import { OauthStateService } from './oauth-state.service';

import { DATABASE_CONNECTION } from '@nexiom/database';
import { type DrizzleDb } from '@nexiom/database';

/**
 * Handles OAuth connectivity, credential storage, and token management.
 * Redis is provided globally by CacheModule (imported in AppModule) so
 * this module simply injects the REDIS_CLIENT token — no factory needed here.
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
export class ConnectionsModule implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionsModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.error('Redis quit failed, forcefully disconnecting', error);
      this.redis.disconnect();
    }
  }
}
