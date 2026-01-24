import {
  DynamicModule,
  Module,
  Provider,
  Global,
  Type,
  ForwardReference,
} from "@nestjs/common";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  AUTH_PROVIDER,
  USER_PROVIDER,
  TENANT_PROVIDER,
  PERMISSION_PROVIDER,
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
  dbToken: string | symbol | Type<any>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  emailToken: string | symbol | Type<any> | Function;
  imports?: (
    | Type<any>
    | DynamicModule
    | Promise<DynamicModule>
    | ForwardReference<any>
  )[];
}

@Global()
@Module({})
export class IdentityModule {
  static register(options: IdentityModuleOptions): DynamicModule {
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
}
