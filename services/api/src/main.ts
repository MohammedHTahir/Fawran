import './config/load-env';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function configuredCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? '';
  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && origins.some((origin) => origin === '*')) {
    throw new Error('CORS_ORIGINS must never contain a wildcard in production');
  }
  return origins;
}

function configuredTrustProxyHops(): number | undefined {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return undefined;
  if (!/^\\d+$/.test(raw.trim())) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  const hops = Number(raw);
  if (!Number.isSafeInteger(hops) || hops > 10) {
    throw new Error('TRUST_PROXY_HOPS must be between 0 and 10');
  }
  return hops;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const express = app.getHttpAdapter().getInstance();
  const production = process.env.NODE_ENV === 'production';
  const corsOrigins = configuredCorsOrigins();
  const trustProxyHops = configuredTrustProxyHops();

  // Never trust forwarded client-IP headers unless the deployment explicitly
  // declares the exact number of trusted reverse-proxy hops.
  if (trustProxyHops !== undefined) express.set('trust proxy', trustProxyHops);
  express.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : production ? false : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Request-Id',
      'X-Provider-Signature',
      'X-Provider-Timestamp',
      'X-Test-Provider-Signature',
    ],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
