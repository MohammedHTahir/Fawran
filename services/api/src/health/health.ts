import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { assertMigrationsCurrent } from '../db/migrations';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.pool.query('select 1');
      await assertMigrationsCurrent(this.pool);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Service is not ready');
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
