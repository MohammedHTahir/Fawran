import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { newDb } from 'pg-mem';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db/db.module';
import { runMigrations } from '../src/db/migrations';

export async function makeApp() {
  const pool = new (newDb().adapters.createPg().Pool)();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PG_POOL).useValue(pool).compile();
  await runMigrations(pool);
  const app = mod.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, pool };
}
