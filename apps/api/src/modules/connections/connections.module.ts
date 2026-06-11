import { Module, Global } from '@nestjs/common';
import {
  EncryptionService,
  TokenManagerService,
  AesEncryptionService,
  OAuthRefreshClient,
  RedisDistributedLock,
} from '@soopa/credentials';
import { DatabaseModule } from '@soopa/database';
import { REDIS_CLIENT } from '@soopa/cache';
import type { Redis } from '@soopa/cache';
import { OAuthCallbackController } from './connections/callback.controller.js';
import { ConnectionLifecycleService } from './connection-lifecycle.service.js';
import { RegistryOAuthRefreshClient } from './connections/registry-token-refresh.service.js';
import { OauthStateService } from './oauth-state.service.js';
import { PiecesModule } from '@soopa/piece-registry';
import { StorageResolverModule } from '@soopa/pipeline';

import { DATABASE_CONNECTION } from '@soopa/database';
import { type DrizzleDb } from '@soopa/database';

import { OAuthController } from './connections/oauth.controller.js';
import { CredentialController } from './connections/credential.controller.js';
import { ConnectionRepository } from './repositories/connection.repository.js';
import { CredentialRepository } from './repositories/credential.repository.js';

import type { AppConnectionRepositoryPort } from './core/ports/outbound/app-connection-repository.port.js';
import type { TenantSchemaPort } from './core/ports/outbound/tenant-schema.port.js';
import type { PieceRegistryPort } from './core/ports/outbound/piece-registry.port.js';
import type { OAuthClientPort } from './core/ports/outbound/oauth-client.port.js';

// --- Hexagonal Architecture Adapters ---
import { DrizzleAppConnectionRepositoryAdapter } from './adapters/outbound/drizzle-app-connection.repository.js';
import { DrizzleTenantSchemaAdapter } from './adapters/outbound/drizzle-tenant-schema.adapter.js';
import { HttpOAuthClientAdapter } from './adapters/outbound/http-oauth-client.adapter.js';
import { NestPieceRegistryAdapter } from './adapters/outbound/nest-piece-registry.adapter.js';
import { PipelineStorageResolverAdapter } from './adapters/outbound/pipeline-storage-resolver.adapter.js';

// --- Hexagonal Architecture Use Cases ---
import { StoreOAuthConnectionUseCase } from './core/use-cases/store-oauth-connection.use-case.js';
import { GetAuthorizationUrlUseCase } from './core/use-cases/get-authorization-url.use-case.js';
import { ExchangeOAuthTokenUseCase } from './core/use-cases/exchange-oauth-token.use-case.js';
import { DeleteConnectionUseCase } from './core/use-cases/delete-connection.use-case.js';

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
  imports: [DatabaseModule, PiecesModule, StorageResolverModule],
  controllers: [OAuthCallbackController, CredentialController, OAuthController],
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
    OauthStateService,
    ConnectionLifecycleService,
    ConnectionRepository,
    CredentialRepository,
    { provide: EncryptionService, useClass: AesEncryptionService },
    { provide: OAuthRefreshClient, useClass: RegistryOAuthRefreshClient },

    // --- Adapters ---
    DrizzleAppConnectionRepositoryAdapter,
    DrizzleTenantSchemaAdapter,
    HttpOAuthClientAdapter,
    NestPieceRegistryAdapter,
    PipelineStorageResolverAdapter,
    {
      provide: 'StorageResolverPort',
      useExisting: PipelineStorageResolverAdapter,
    },

    // --- Use Cases ---
    {
      provide: StoreOAuthConnectionUseCase,
      useFactory: (
        appConnectionRepo: AppConnectionRepositoryPort,
        tenantSchemaAdapter: TenantSchemaPort,
      ) => {
        return new StoreOAuthConnectionUseCase(
          appConnectionRepo,
          tenantSchemaAdapter,
          process.env.DEFAULT_REGION_CONTEXT,
        );
      },
      inject: [
        DrizzleAppConnectionRepositoryAdapter,
        DrizzleTenantSchemaAdapter,
      ],
    },
    {
      provide: GetAuthorizationUrlUseCase,
      useFactory: (pieceRegistry: PieceRegistryPort) => {
        return new GetAuthorizationUrlUseCase(
          pieceRegistry,
          process.env.FRONTEND_URL || 'http://localhost:3000',
        );
      },
      inject: [NestPieceRegistryAdapter],
    },
    {
      provide: ExchangeOAuthTokenUseCase,
      useFactory: (
        pieceRegistry: PieceRegistryPort,
        oauthClient: OAuthClientPort,
      ) => {
        return new ExchangeOAuthTokenUseCase(
          pieceRegistry,
          oauthClient,
          process.env.FRONTEND_URL || 'http://localhost:3000',
        );
      },
      inject: [NestPieceRegistryAdapter, HttpOAuthClientAdapter],
    },
    {
      provide: DeleteConnectionUseCase,
      useFactory: (tenantSchemaAdapter: TenantSchemaPort) => {
        return new DeleteConnectionUseCase(tenantSchemaAdapter);
      },
      inject: [DrizzleTenantSchemaAdapter],
    },
  ],
  exports: [
    TokenManagerService,
    ConnectionLifecycleService,
    ConnectionRepository,
    CredentialRepository,
  ],
})
export class ConnectionsModule {}
