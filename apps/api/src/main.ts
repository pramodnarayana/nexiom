import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;

  // Enable CORS
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
      if (process.env.NODE_ENV !== 'production' && !origin) {
        // Allow no origin/curl in dev
        callback(null, true);
        return;
      }
      if (origin && allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });

  await app.listen(port);
  Logger.log(
    `Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

// Top-level await is not available in CommonJS.

void (async () => {
  try {
    await bootstrap();
  } catch (err) {
    Logger.error('Bootstrap failed', err);
    process.exit(1);
  }
})();
