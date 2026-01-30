import {
  DynamicModule,
  Module,
  Provider,
  Global,
  Type,
  ModuleMetadata,
} from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  AUTH_PROVIDER,
  USER_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
  IDENTITY_OPTIONS,
} from "./constants";
import {
  BetterAuthAdapter,
  BetterAuthAdapterConfig,
} from "./adapters/better-auth.adapter";
import { DrizzleUserAdapter } from "./adapters/drizzle-user.adapter";
import { DrizzleTenantAdapter } from "./adapters/drizzle-tenant.adapter";
import { DrizzlePermissionAdapter } from "./adapters/drizzle-permission.adapter";
import { IAuthProvider, IEmailProvider } from "./interfaces";
import * as schema from "./schema";

export interface IdentityModuleOptions {
  betterAuthConfig: BetterAuthAdapterConfig;
  dbToken?: string | symbol | Type<any>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  emailToken?: string | symbol | Type<any> | Function;
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

    const authProvider: Provider = {
      provide: AUTH_PROVIDER,
      useFactory: (
        db: NodePgDatabase<typeof schema>,
        emailService: IEmailProvider,
      ) => {
        return new BetterAuthAdapter(
          db,
          emailService,
          options.betterAuthConfig,
        );
      },
      inject: [options.dbToken, options.emailToken],
    };

    const userProvider: Provider = {
      provide: USER_PROVIDER,
      useFactory: (
        db: NodePgDatabase<typeof schema>,
        authProvider: IAuthProvider,
      ) => {
        return new DrizzleUserAdapter(db, authProvider);
      },
      inject: [options.dbToken, AUTH_PROVIDER],
    };

    const tenantProvider: Provider = {
      provide: TENANT_PROVIDER,
      useFactory: (db: NodePgDatabase<typeof schema>) => {
        return new DrizzleTenantAdapter(db);
      },
      inject: [options.dbToken],
    };

    const permissionProvider: Provider = {
      provide: PERMISSION_PROVIDER,
      useFactory: (db: NodePgDatabase<typeof schema>) => {
        return new DrizzlePermissionAdapter(db);
      },
      inject: [options.dbToken],
    };

    return {
      module: IdentityModule,
      imports: options.imports || [],
      providers: [
        authProvider,
        userProvider,
        tenantProvider,
        permissionProvider,
      ],
      exports: [
        AUTH_PROVIDER,
        USER_PROVIDER,
        TENANT_PROVIDER,
        PERMISSION_PROVIDER,
      ],
    };
  }

  static registerAsync(options: {
    imports?: ModuleMetadata["imports"];

    useFactory: (
      ...args: any[]
    ) => Promise<IdentityModuleOptions> | IdentityModuleOptions;

    inject?: (string | symbol | Type<any> | Function)[];
  }): DynamicModule {
    return {
      module: IdentityModule,
      imports: options.imports || [],
      providers: [
        {
          provide: IDENTITY_OPTIONS,

          useFactory: async (...args: any[]) => {
            const identityOptions = await options.useFactory(...args);
            if (!identityOptions.db || !identityOptions.email) {
              throw new Error(
                "db and email instances must be provided in IdentityModuleOptions for registerAsync",
              );
            }
            return identityOptions;
          },
          inject: options.inject || [],
        },
        {
          provide: AUTH_PROVIDER,
          useFactory: (identityOptions: IdentityModuleOptions) => {
            // Validated in IDENTITY_OPTIONS factory
            return new BetterAuthAdapter(
              identityOptions.db!,
              identityOptions.email!,
              identityOptions.betterAuthConfig,
            );
          },
          inject: [IDENTITY_OPTIONS],
        },
        {
          provide: USER_PROVIDER,
          useFactory: (
            identityOptions: IdentityModuleOptions,
            authProvider: IAuthProvider,
          ) => {
            // Validated in IDENTITY_OPTIONS factory
            return new DrizzleUserAdapter(identityOptions.db!, authProvider);
          },
          inject: [IDENTITY_OPTIONS, AUTH_PROVIDER],
        },
        {
          provide: TENANT_PROVIDER,
          useFactory: (identityOptions: IdentityModuleOptions) => {
            // Validated in IDENTITY_OPTIONS factory
            return new DrizzleTenantAdapter(identityOptions.db!);
          },
          inject: [IDENTITY_OPTIONS],
        },
        {
          provide: PERMISSION_PROVIDER,
          useFactory: (identityOptions: IdentityModuleOptions) => {
            // Validated in IDENTITY_OPTIONS factory
            return new DrizzlePermissionAdapter(identityOptions.db!);
          },
          inject: [IDENTITY_OPTIONS],
        },
      ],
      exports: [
        AUTH_PROVIDER,
        USER_PROVIDER,
        TENANT_PROVIDER,
        PERMISSION_PROVIDER,
      ],
    };
  }
}
