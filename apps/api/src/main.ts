import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from './config/env';

async function bootstrap() {
  const e = env(); // gagal cepat bila konfigurasi tidak valid
  const app = await NestFactory.create(AppModule, {
    logger: e.NODE_ENV === 'production' ? ['log', 'warn', 'error'] : undefined,
  });
  configureApp(app);
  await app.listen(e.API_PORT);
  new Logger('Bootstrap').log(
    `SMGE API berjalan di http://localhost:${e.API_PORT}/api (${e.NODE_ENV})`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
