import type {
  DynamicModule,
  ModuleMetadata,
  InjectionToken,
} from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  AUTH_PROVIDER,
  USER_REPOSITORY,
  TENANT_REPOSITORY,
  PERMISSION_REPOSITORY,
  EMAIL_PROVIDER,
  IDENTITY_OPTIONS,
  IDENTITY_DB,
  BETTER_AUTH_CONFIG,
  ROLE_REPOSITORY,
  IDENTITY_EVENT_PUBLISHER,
} from "./constants.js";
import { BetterAuthAdapter } from "./adapters/outbound/better-auth.adapter.js";
import type { BetterAuthAdapterConfig } from "./core/ports/outbound/better-auth-config.port.js";
import { DrizzleUserRepositoryAdapter } from "./adapters/outbound/drizzle-user.repository.js";
import { DrizzleTenantRepositoryAdapter } from "./adapters/outbound/drizzle-tenant.repository.js";
import { DrizzlePermissionRepositoryAdapter } from "./adapters/outbound/drizzle-permission.repository.js";
import { DrizzleRoleRepositoryAdapter } from "./adapters/outbound/drizzle-role.repository.js";
import type { IEmailProvider } from "./core/ports/outbound/email-provider.port.js";
import * as schema from "./schema.js";
import { PermissionSeeder } from "./services/permission-seeder.js";
import { IdentityEventPublisher } from "./services/identity-event-publisher.service.js";
import { ListUsersWithInvitationsUseCase } from "./core/use-cases/users/list-users-with-invitations.use-case.js";
import { RemoveUserUseCase } from "./core/use-cases/users/remove-user.use-case.js";
import { GetUserProfileUseCase } from "./core/use-cases/users/get-user-profile.use-case.js";
import { CreateUserUseCase } from "./core/use-cases/users/create-user.use-case.js";
import { GetUserByIdUseCase } from "./core/use-cases/users/get-user-by-id.use-case.js";

export interface IdentityConstants {
  systemTenantId: string;
  ownerRoleId: string;
  adminRoleId: string;
  memberRoleId: string;
}

export interface IdentityModuleOptions {
  betterAuthConfig: BetterAuthAdapterConfig;
  constants: IdentityConstants;
  dbToken?: InjectionToken;
  emailToken?: InjectionToken;
  eventPublisherToken?: InjectionToken;
  // Resolved instances (for async injection)
  db?: NodePgDatabase<typeof schema>;
  email?: IEmailProvider;
  imports?: ModuleMetadata["imports"];
}

@Global()
@Module({})
export class IdentityModule {
  static register(options: IdentityModuleOptions): DynamicModule {
    // Ensure tokens are provided for synchronous registration
    if (!options.dbToken || !options.emailToken) {
      throw new Error(
        "dbToken and emailToken are required for synchronous registration",
      );
    }
    if (!options.constants) {
      throw new Error("constants are required for synchronous registration");
    }

    return {
      module: IdentityModule,
      imports: options.imports || [],
      providers: [
        {
          provide: IDENTITY_OPTIONS,
          useValue: options,
        },
        {
          provide: BETTER_AUTH_CONFIG,
          useValue: options.betterAuthConfig,
        },
        {
          provide: IDENTITY_DB,
          useExisting: options.dbToken,
        },
        {
          provide: EMAIL_PROVIDER,
          useExisting: options.emailToken,
        },
        {
          provide: AUTH_PROVIDER,
          useClass: BetterAuthAdapter,
        },
        {
          provide: USER_REPOSITORY,
          useClass: DrizzleUserRepositoryAdapter,
        },
        {
          provide: TENANT_REPOSITORY,
          useClass: DrizzleTenantRepositoryAdapter,
        },
        {
          provide: PERMISSION_REPOSITORY,
          useClass: DrizzlePermissionRepositoryAdapter,
        },
        {
          provide: ROLE_REPOSITORY,
          useClass: DrizzleRoleRepositoryAdapter,
        },
        options.eventPublisherToken
          ? {
              provide: IDENTITY_EVENT_PUBLISHER,
              useExisting: options.eventPublisherToken,
            }
          : {
              provide: IDENTITY_EVENT_PUBLISHER,
              useClass: IdentityEventPublisher,
            },
        PermissionSeeder,
        ListUsersWithInvitationsUseCase,
        RemoveUserUseCase,
        GetUserProfileUseCase,
        CreateUserUseCase,
        GetUserByIdUseCase,
      ],
      exports: [
        IDENTITY_OPTIONS,
        IDENTITY_DB,
        BETTER_AUTH_CONFIG,
        EMAIL_PROVIDER,
        AUTH_PROVIDER,
        USER_REPOSITORY,
        TENANT_REPOSITORY,
        PERMISSION_REPOSITORY,
        ROLE_REPOSITORY,
        IDENTITY_EVENT_PUBLISHER,
        PermissionSeeder,
        ListUsersWithInvitationsUseCase,
        RemoveUserUseCase,
        GetUserProfileUseCase,
        CreateUserUseCase,
        GetUserByIdUseCase,
      ],
    };
  }

  static registerAsync(options: {
    imports?: ModuleMetadata["imports"];

    useFactory: (
      ...args: unknown[]
    ) => Promise<IdentityModuleOptions> | IdentityModuleOptions;

    inject?: InjectionToken[];
    eventPublisherToken?: InjectionToken;
  }): DynamicModule {
    return {
      module: IdentityModule,
      imports: options.imports || [],
      providers: [
        {
          provide: IDENTITY_OPTIONS,

          useFactory: async (...args: unknown[]) => {
            const identityOptions = await options.useFactory(...args);
            if (!identityOptions.db || !identityOptions.email) {
              throw new Error(
                "db and email instances must be provided in IdentityModuleOptions for registerAsync",
              );
            }
            if (!identityOptions.constants) {
              throw new Error(
                "constants must be provided in IdentityModuleOptions for registerAsync",
              );
            }
            return identityOptions;
          },
          inject: options.inject || [],
        },
        {
          provide: BETTER_AUTH_CONFIG,
          useFactory: (identityOptions: IdentityModuleOptions) =>
            identityOptions.betterAuthConfig,
          inject: [IDENTITY_OPTIONS],
        },
        {
          provide: IDENTITY_DB,
          useFactory: (identityOptions: IdentityModuleOptions) => {
            // Validation above ensures db is defined
            return identityOptions.db;
          },
          inject: [IDENTITY_OPTIONS],
        },
        {
          provide: EMAIL_PROVIDER,
          useFactory: (identityOptions: IdentityModuleOptions) => {
            // Validation above ensures email is defined
            return identityOptions.email;
          },
          inject: [IDENTITY_OPTIONS],
        },
        {
          provide: AUTH_PROVIDER,
          useClass: BetterAuthAdapter,
        },
        {
          provide: USER_REPOSITORY,
          useClass: DrizzleUserRepositoryAdapter,
        },
        {
          provide: TENANT_REPOSITORY,
          useClass: DrizzleTenantRepositoryAdapter,
        },
        {
          provide: PERMISSION_REPOSITORY,
          useClass: DrizzlePermissionRepositoryAdapter,
        },
        {
          provide: ROLE_REPOSITORY,
          useClass: DrizzleRoleRepositoryAdapter,
        },
        options.eventPublisherToken
          ? {
              provide: IDENTITY_EVENT_PUBLISHER,
              useExisting: options.eventPublisherToken,
            }
          : {
              provide: IDENTITY_EVENT_PUBLISHER,
              useClass: IdentityEventPublisher,
            },
        PermissionSeeder,
        ListUsersWithInvitationsUseCase,
        RemoveUserUseCase,
        GetUserProfileUseCase,
        CreateUserUseCase,
        GetUserByIdUseCase,
      ],
      exports: [
        IDENTITY_OPTIONS,
        IDENTITY_DB,
        BETTER_AUTH_CONFIG,
        EMAIL_PROVIDER,
        AUTH_PROVIDER,
        USER_REPOSITORY,
        TENANT_REPOSITORY,
        PERMISSION_REPOSITORY,
        ROLE_REPOSITORY,
        IDENTITY_EVENT_PUBLISHER,
        PermissionSeeder,
        ListUsersWithInvitationsUseCase,
        RemoveUserUseCase,
        GetUserProfileUseCase,
        CreateUserUseCase,
        GetUserByIdUseCase,
      ],
    };
  }
}
