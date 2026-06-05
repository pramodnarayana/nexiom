import type { DynamicModule, ModuleMetadata, Type } from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  AUTH_PROVIDER,
  USER_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
  EMAIL_PROVIDER,
  IDENTITY_OPTIONS,
  IDENTITY_DB,
  BETTER_AUTH_CONFIG,
  ROLE_PROVIDER,
  IDENTITY_EVENT_PUBLISHER,
} from "./constants.js";
import { BetterAuthAdapter } from "./adapters/better-auth.adapter.js";
import type { BetterAuthAdapterConfig } from "./interfaces/better-auth-config.interface.js";
import { DrizzleUserAdapter } from "./adapters/drizzle-user.adapter.js";
import { DrizzleTenantAdapter } from "./adapters/drizzle-tenant.adapter.js";
import { DrizzlePermissionAdapter } from "./adapters/drizzle-permission.adapter.js";
import { DrizzleRoleAdapter } from "./adapters/drizzle-role.adapter.js";
import type { IEmailProvider } from "./interfaces/email-provider.interface.js";
import * as schema from "./schema.js";
import { PermissionSeeder } from "./services/permission-seeder.js";
import { IdentityEventPublisher } from "./services/identity-event-publisher.service.js";

export interface IdentityConstants {
  systemTenantId: string;
  ownerRoleId: string;
  adminRoleId: string;
  memberRoleId: string;
}

export interface IdentityModuleOptions {
  betterAuthConfig: BetterAuthAdapterConfig;
  constants: IdentityConstants;
  dbToken?: string | symbol | Type<any>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  emailToken?: string | symbol | Type<any> | Function;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  eventPublisherToken?: string | symbol | Type<any> | Function;
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
          provide: USER_PROVIDER,
          useClass: DrizzleUserAdapter,
        },
        {
          provide: TENANT_PROVIDER,
          useClass: DrizzleTenantAdapter,
        },
        {
          provide: PERMISSION_PROVIDER,
          useClass: DrizzlePermissionAdapter,
        },
        {
          provide: ROLE_PROVIDER,
          useClass: DrizzleRoleAdapter,
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
      ],
      exports: [
        IDENTITY_OPTIONS,
        IDENTITY_DB,
        BETTER_AUTH_CONFIG,
        EMAIL_PROVIDER,
        AUTH_PROVIDER,
        USER_PROVIDER,
        TENANT_PROVIDER,
        PERMISSION_PROVIDER,
        ROLE_PROVIDER,
        IDENTITY_EVENT_PUBLISHER,
        PermissionSeeder,
      ],
    };
  }

  static registerAsync(options: {
    imports?: ModuleMetadata["imports"];

    useFactory: (
      ...args: any[]
    ) => Promise<IdentityModuleOptions> | IdentityModuleOptions;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    inject?: (string | symbol | Type<any> | Function)[];
  }): DynamicModule {
    return {
      module: IdentityModule,
      imports: options.imports || [],
      providers: [
        {
          provide: IDENTITY_OPTIONS,

          useFactory: async (...args: any[]) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
          provide: USER_PROVIDER,
          useClass: DrizzleUserAdapter,
        },
        {
          provide: TENANT_PROVIDER,
          useClass: DrizzleTenantAdapter,
        },
        {
          provide: PERMISSION_PROVIDER,
          useClass: DrizzlePermissionAdapter,
        },
        {
          provide: ROLE_PROVIDER,
          useClass: DrizzleRoleAdapter,
        },
        // Use useClass as default to avoid circular dependency issues
        {
          provide: IDENTITY_EVENT_PUBLISHER,
          useClass: IdentityEventPublisher,
        },
        PermissionSeeder,
      ],
      exports: [
        IDENTITY_OPTIONS,
        IDENTITY_DB,
        BETTER_AUTH_CONFIG,
        EMAIL_PROVIDER,
        AUTH_PROVIDER,
        USER_PROVIDER,
        TENANT_PROVIDER,
        PERMISSION_PROVIDER,
        ROLE_PROVIDER,
        IDENTITY_EVENT_PUBLISHER,
        PermissionSeeder,
      ],
    };
  }
}
