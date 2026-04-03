import type {
  DynamicModule,
  InjectionToken,
  ModuleMetadata,
} from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { QUEUE_MODULE_OPTIONS, QUEUE_SERVICE } from "./constants.js";
import { QueueService } from "./queue.service.js";

export interface QueueModuleOptions {
  /** 'local' → LocalStack endpoint. 'production' → real AWS SQS. */
  infraMode: "local" | "production";
  /** AWS region. Default: 'us-east-1'. */
  region?: string;
  /** Override SQS endpoint URL. Required when infraMode = 'local'. */
  endpoint?: string;
  /**
   * AWS account ID used to build queue URLs in production.
   * Typically sourced from SSM or an env var.
   * LocalStack always uses '000000000000'.
   */
  accountId?: string;
  /**
   * When false, all consume() calls are no-ops and no SQS polling is started.
   * Useful for lightweight dev environments without LocalStack.
   * Default: true.
   */
  enabled?: boolean;
}

export interface QueueModuleAsyncOptions extends Pick<
  ModuleMetadata,
  "imports"
> {
  useFactory: (
    ...args: unknown[]
  ) => Promise<QueueModuleOptions> | QueueModuleOptions;
  inject?: InjectionToken[];
}

/**
 * Global NestJS dynamic module for SQS-backed queue operations.
 *
 * Register once in AppModule:
 * ```typescript
 * QueueModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (cfg: ConfigService) => ({
 *     infraMode: cfg.get('INFRA_MODE'),
 *     endpoint: cfg.get('SQS_ENDPOINT'),
 *     region:   cfg.get('AWS_REGION', 'us-east-1'),
 *     accountId: cfg.get('AWS_ACCOUNT_ID'),
 *   }),
 * })
 * ```
 *
 * Inject in any service:
 * ```typescript
 * constructor(@Inject(QUEUE_SERVICE) private readonly queue: IQueueService) {}
 * ```
 */
@Global()
@Module({})
export class QueueModule {
  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    return {
      global: true,
      module: QueueModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: QUEUE_MODULE_OPTIONS,
          useFactory: options.useFactory,

          inject: options.inject ?? [],
        },
        {
          provide: QUEUE_SERVICE,
          useClass: QueueService,
        },
        {
          provide: QueueService,
          useExisting: QUEUE_SERVICE,
        },
      ],
      exports: [QUEUE_SERVICE, QueueService],
    };
  }
}
