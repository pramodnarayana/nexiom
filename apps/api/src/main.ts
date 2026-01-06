import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';

import * as fs from 'fs';
import * as path from 'path';

import cookieParser from 'cookie-parser';

async function bootstrap() {
  console.log(`[Diagnostic] CWD: ${process.cwd()}`);
  console.log(`[Diagnostic] .env exists? ${fs.existsSync(path.resolve(process.cwd(), '.env'))}`);
  console.log(`[Diagnostic] apps/api/.env exists? ${fs.existsSync(path.resolve(process.cwd(), 'apps/api/.env'))}`);

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  console.log('Global prefix set to /api');
  // Use Zod for all validation globally
  app.useGlobalPipes(new ZodValidationPipe());
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',');
  if (!allowedOrigins || allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS environment variable is not defined');
  }

  app.enableCors({
    origin: allowedOrigins,
    credentials: true, // Allow cookies
  });
  app.use(cookieParser()); // Enable cookie parsing
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
