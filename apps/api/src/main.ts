import cookieParser from 'cookie-parser';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Behind Nginx in production (TLS terminates at Nginx, plain HTTP to this
  // container) - without this, Express sees every request as coming from
  // the proxy itself over HTTP, not the real client over HTTPS. `1` trusts
  // exactly one hop (Nginx), matching the target topology (Nginx -> API,
  // nothing else in between). Harmless in local dev (no proxy sits in front,
  // so there's nothing for this setting to change).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(cookieParser());

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
