import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import {
  ProviderRegistryService,
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
} from '@nexiom/engine';
import { DbModule } from '../../db/db.module';
import { OAuthCallbackController } from './connections/callback.controller';
import { ConnectorsController } from './connections/connectors.controller';
import { DefaultOAuthRefreshClient } from './connections/token-refresh.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [DbModule],
  controllers: [OAuthCallbackController, ConnectorsController],
  providers: [
    ProviderRegistryService,
    TokenManagerService,
    { provide: EncryptionService, useClass: AesEncryptionService },
    { provide: OAuthRefreshClient, useClass: DefaultOAuthRefreshClient },
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis(
          config.get<string>('REDIS_URL') || 'redis://localhost:6379',
        );
      },
    },
  ],
})
export class EngineModule implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}
