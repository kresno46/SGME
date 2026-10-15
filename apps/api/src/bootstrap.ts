import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env';

/** Konfigurasi HTTP bersama untuk main.ts dan integration test. */
export function configureApp(app: INestApplication) {
  const e = env();
  const express = app as NestExpressApplication;
  // Nginx berada di depan API: percayai 1 hop proxy agar req.ip berisi IP klien asli.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: e.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();
}
