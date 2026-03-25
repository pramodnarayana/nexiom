import 'dotenv/config';
import { Logger } from '@nestjs/common';
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
      Logger.error(
        `WINDMILL_ENABLED=true but the following required variables are not set: ${missing.join(', ')}. ` +
          `Set WINDMILL_ENABLED=false to use StubWindmillClient for local development.`,
        'Bootstrap',
      );
      process.exit(1);
    }
  }
}

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
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

      // Allow requests with no origin (like mobile apps, curl, or same-origin)
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
  Logger.log(
    `Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

try {
  await bootstrap();
} catch (err) {
  Logger.error('Bootstrap failed', err);
  process.exit(1);
}
