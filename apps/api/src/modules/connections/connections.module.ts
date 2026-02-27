import { Module, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import {
  ProviderRegistryService,
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
} from '@nexiom/connections';
import { DbModule } from '../../db/db.module';
import { OAuthCallbackController } from './connections/callback.controller';
import { ConnectorsController } from './connections/connectors.controller';
import { DefaultOAuthRefreshClient } from './connections/token-refresh.service';
import { ConnectorsService } from './connectors.service';
import { OauthStateService } from './oauth-state.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

import { DATABASE_CONNECTION } from '@nexiom/database';
import { type DrizzleDb } from '@nexiom/database';

// ... other imports

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
        'REDIS_CLIENT',
        EncryptionService,
        OAuthRefreshClient,
      ],
    },
    ConnectorsService,
    OauthStateService,
    { provide: EncryptionService, useClass: AesEncryptionService },
    { provide: OAuthRefreshClient, useClass: DefaultOAuthRefreshClient },
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (!redisUrl && config.get<string>('NODE_ENV') !== 'development') {
          throw new Error('REDIS_URL environment variable is missing');
        }
        const client = new Redis(redisUrl || 'redis://localhost:6379', {
          connectTimeout: 10000,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: true,
        });
        await client.connect();
        return client;
      },
    },
  ],
})
export class ConnectionsModule implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionsModule.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.error('Redis quit failed, forcefully disconnecting', error);
      this.redis.disconnect();
    }
  }
}
