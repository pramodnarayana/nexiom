import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TokenManagerService,
  OAuthRefreshClient,
  RedisDistributedLock,
} from '@soopa/credentials';
import { IEncryptionService, ENCRYPTION_SERVICE } from '@soopa/security';
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
import type { ConnectionLifecyclePort } from './core/ports/outbound/connection-lifecycle.port.js';
import type { PieceRegistryPort } from './core/ports/outbound/piece-registry.port.js';
import type { OAuthClientPort } from './core/ports/outbound/oauth-client.port.js';

// --- Hexagonal Architecture Adapters ---
import { DrizzleAppConnectionRepositoryAdapter } from './adapters/outbound/drizzle-app-connection.adapter.js';
import { DrizzleConnectionLifecycleAdapter } from './adapters/outbound/drizzle-connection-lifecycle.adapter.js';
import { HttpOAuthClientAdapter } from './adapters/outbound/http-oauth-client.adapter.js';
import { NestPieceRegistryAdapter } from './adapters/outbound/nest-piece-registry.adapter.js';
import { PipelineStorageResolverAdapter } from './adapters/outbound/pipeline-storage-resolver.adapter.js';

// --- Hexagonal Architecture Use Cases ---
import { StoreOAuthConnectionUseCase } from './core/use-cases/store-oauth-connection.use-case.js';
import { GetAuthorizationUrlUseCase } from './core/use-cases/get-authorization-url.use-case.js';
import { ExchangeOAuthTokenUseCase } from './core/use-cases/exchange-oauth-token.use-case.js';
import { DeleteConnectionUseCase } from './core/use-cases/delete-connection.use-case.js';
import { GetExistingOAuthCredentialsUseCase } from './core/use-cases/get-existing-oauth-credentials.use-case.js';

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
        REDIS_CLIENT,
        ENCRYPTION_SERVICE,
        OAuthRefreshClient,
      ],
    },
    OauthStateService,
    ConnectionLifecycleService,
    ConnectionRepository,
    CredentialRepository,
    { provide: OAuthRefreshClient, useClass: RegistryOAuthRefreshClient },

    // --- Adapters ---
    DrizzleAppConnectionRepositoryAdapter,
    DrizzleConnectionLifecycleAdapter,
    HttpOAuthClientAdapter,
    NestPieceRegistryAdapter,
    PipelineStorageResolverAdapter,

    // --- Use Cases ---
    {
      provide: StoreOAuthConnectionUseCase,
      useFactory: (
        appConnectionRepo: AppConnectionRepositoryPort,
        connectionLifecycleAdapter: ConnectionLifecyclePort,
        crypto: IEncryptionService,
      ) => {
        return new StoreOAuthConnectionUseCase(
          appConnectionRepo,
          connectionLifecycleAdapter,
          crypto,
          process.env.DEFAULT_REGION_CONTEXT,
        );
      },
      inject: [
        DrizzleAppConnectionRepositoryAdapter,
        DrizzleConnectionLifecycleAdapter,
        ENCRYPTION_SERVICE,
      ],
    },
    {
      provide: GetAuthorizationUrlUseCase,
      useFactory: (
        pieceRegistry: PieceRegistryPort,
        configService: ConfigService,
      ) => {
        // Enterprise-grade: Fetch strongly-typed config instead of naked process.env
        const apiUrl =
          configService.get<string>('API_URL') || 'http://localhost:3000/api';
        const apiBaseUrl = apiUrl.replace(/\/api\/?$/, '');

        return new GetAuthorizationUrlUseCase(pieceRegistry, apiBaseUrl);
      },
      inject: [NestPieceRegistryAdapter, ConfigService],
    },
    {
      provide: ExchangeOAuthTokenUseCase,
      useFactory: (
        pieceRegistry: PieceRegistryPort,
        oauthClient: OAuthClientPort,
        configService: ConfigService,
      ) => {
        const apiUrl =
          configService.get<string>('API_URL') || 'http://localhost:3000/api';
        const apiBaseUrl = apiUrl.replace(/\/api\/?$/, '');

        return new ExchangeOAuthTokenUseCase(
          pieceRegistry,
          oauthClient,
          apiBaseUrl,
        );
      },
      inject: [NestPieceRegistryAdapter, HttpOAuthClientAdapter, ConfigService],
    },
    {
      provide: DeleteConnectionUseCase,
      useFactory: (connectionLifecycleAdapter: ConnectionLifecyclePort) => {
        return new DeleteConnectionUseCase(connectionLifecycleAdapter);
      },
      inject: [DrizzleConnectionLifecycleAdapter],
    },
    GetExistingOAuthCredentialsUseCase,
  ],
  exports: [
    TokenManagerService,
    ConnectionLifecycleService,
    ConnectionRepository,
    CredentialRepository,
  ],
})
export class ConnectionsModule {}
