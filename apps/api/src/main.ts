import 'dotenv/config';
import '@nexiom/application-revenova';
import * as express from 'express';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app/app.module.js';
import { ShutdownService } from './core/shutdown.service.js';

function validateEnv(): void {
  if (process.env.WINDMILL_ENABLED === 'true') {
    const missing = (
      ['WINDMILL_TOKEN', 'WINDMILL_INTERNAL_SECRET'] as const
    ).filter((k) => !process.env[k]);
    if (missing.length > 0) {
      // Logger is not yet available at this point — use console directly.
      console.error(
        `[Bootstrap] WINDMILL_ENABLED=true but the following required variables are not set: ${missing.join(', ')}. ` +
          `Set WINDMILL_ENABLED=false to use StubWindmillClient for local development.`,
      );
      process.exit(1);
    }
  }
}

async function bootstrap() {
  validateEnv();
  // bufferLogs: true holds NestJS bootstrap logs until the pino logger is ready,
  // preventing a mix of default NestJS and pino output during startup.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const globalPrefix = 'api';
  // Webhooks must NOT carry the /api prefix — vendor systems (Salesforce,
  // QuickBooks, etc.) POST directly to the URL we give them and cannot
  // dynamically inject path segments. Excluding 'webhooks' here keeps the
  // ingest surface at POST /webhooks/:connectionId for every vendor.
  app.setGlobalPrefix(globalPrefix, { exclude: ['webhooks', 'webhooks/(.*)'] });

  // Add fallback parser for raw payloads to support XML/plain webhooks
  app.use('/webhooks', express.text({ type: '*/*', limit: '50mb' }));

  const port = process.env.PORT || 3000;

  // Validate DTOs
  app.useGlobalPipes(new ZodValidationPipe());

  // Enable CORS
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);

      const isDev = process.env.NODE_ENV !== 'production';

      if (isDev && (!origin || allowedOrigins.length === 0)) {
        // Allow no origin/curl or any origin if list is empty in dev
        callback(null, true);
        return;
      }

      // Vendor webhook senders (Salesforce, QuickBooks, etc.) send no Origin header —
      // CORS restrictions only apply to browser cross-origin requests.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  await app.listen(port);
  // NOTE: NestJS built-in app.enableShutdownHooks() is intentionally NOT called.
  // ShutdownService provides the same functionality with an additional 30-second
  // hard-deadline guard. Calling both would result in double app.close() invocations.
  app.get(ShutdownService).enableShutdownHooks(app);
  app
    .get(Logger)
    .log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

try {
  await bootstrap();
} catch (err: unknown) {
  // Logger is not yet available if bootstrap itself fails before app.useLogger();
  // fall back to console so the error is never silently swallowed.
  console.error(
    '[Bootstrap] Fatal error:',
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
}
