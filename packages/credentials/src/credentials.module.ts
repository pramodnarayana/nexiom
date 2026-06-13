import { Module, Global, DynamicModule } from '@nestjs/common';
import { DATABASE_CONNECTION } from '@soopa/database';
import { ENCRYPTION_SERVICE } from '@soopa/security';
import type { DrizzleDb } from '@soopa/database';
import type { IEncryptionService } from '@soopa/security';
import type { Redis } from 'ioredis';

import { TokenManagerService, OAuthRefreshClient } from './oauth/token-manager.service.js';
import { RedisDistributedLock } from './oauth/redis-lock.js';

export interface CredentialsModuleOptions {
  imports?: any[];
  providers?: any[];
  inject?: any[];
  useFactory: (...args: any[]) => OAuthRefreshClient;
}

@Global()
@Module({})
export class CredentialsModule {
  static forRootAsync(options: CredentialsModuleOptions): DynamicModule {
    return {
      module: CredentialsModule,
      imports: options.imports || [],
      providers: [
        ...(options.providers || []),
        {
          provide: OAuthRefreshClient,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: TokenManagerService,
          useFactory: (
            db: DrizzleDb,
            redis: Redis,
            crypto: IEncryptionService,
            refreshClient: OAuthRefreshClient,
          ) => {
            return new TokenManagerService(
              db,
              new RedisDistributedLock(redis),
              crypto,
              refreshClient,
            );
          },
          inject: [
            DATABASE_CONNECTION,
            'REDIS_CLIENT',
            ENCRYPTION_SERVICE,
            OAuthRefreshClient,
          ],
        },
      ],
      exports: [TokenManagerService, OAuthRefreshClient],
    };
  }
}
