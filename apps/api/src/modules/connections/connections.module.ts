import { Module, Global } from '@nestjs/common';
import {
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
  RedisDistributedLock,
} from '@soopa/credentials';
import { DbModule } from '../../db/db.module.js';
import { REDIS_CLIENT } from '@soopa/cache';
import type { Redis } from '@soopa/cache';
import { OAuthCallbackController } from './connections/callback.controller.js';
import { ConnectionLifecycleService } from './connection-lifecycle.service.js';
import { RegistryOAuthRefreshClient } from './connections/registry-token-refresh.service.js';
import { OauthStateService } from './oauth-state.service.js';
import { PiecesModule } from '@soopa/piece-registry';
import { StorageResolverModule } from '@soopa/engine';

import { DATABASE_CONNECTION } from '@soopa/database';
import { type DrizzleDb } from '@soopa/database';

import { OAuthController } from './connections/oauth.controller.js';
import { CredentialController } from './connections/credential.controller.js';
import { OAuthOrchestrationService } from './services/oauth-orchestration.service.js';
import { CredentialLinkingService } from './services/credential-linking.service.js';
import { ConnectionRepository } from './repositories/connection.repository.js';
import { CredentialRepository } from './repositories/credential.repository.js';

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
  imports: [DbModule, PiecesModule, StorageResolverModule],
  controllers: [OAuthCallbackController, OAuthController, CredentialController],
  providers: [
    {
      provide: TokenManagerService,
      useFactory: (
        db: DrizzleDb,
        redis: Redis,
        crypto: EncryptionService,
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
        REDIS_CLIENT,
        EncryptionService,
        OAuthRefreshClient,
      ],
    },
    OAuthOrchestrationService,
    CredentialLinkingService,
    OauthStateService,
    ConnectionLifecycleService,
    ConnectionRepository,
    CredentialRepository,
    { provide: EncryptionService, useClass: AesEncryptionService },
    { provide: OAuthRefreshClient, useClass: RegistryOAuthRefreshClient },
  ],
  exports: [
    TokenManagerService,
    ConnectionLifecycleService,
    ConnectionRepository,
    CredentialRepository,
  ],
})
export class ConnectionsModule {}
