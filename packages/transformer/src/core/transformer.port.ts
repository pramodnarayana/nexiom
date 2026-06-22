export interface TransformationLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface TransformationContext {
  traceId?: string;
  tenantId?: string;
  logger?: TransformationLogger;
  [key: string]: unknown;
}

export interface TransformerPort<TInput = unknown, TOutput = unknown> {
  transform(input: TInput, context?: TransformationContext): TOutput | Promise<TOutput>;
}
