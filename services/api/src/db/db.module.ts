import { Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { assertMigrationsCurrent } from './migrations';

export const PG_POOL = 'PG_POOL';
export const SYSTEM_PROVIDER_ACCOUNT = 'sys:provider';

@Injectable()
class DbSchemaGuard implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_POOL) private pool: Pool) {}
  async onModuleDestroy() { await this.pool.end().catch(() => undefined); }
  async onModuleInit() {
    // Schema changes are deployment operations. API startup only verifies that
    // the required migration version is already installed.
    await assertMigrationsCurrent(this.pool);
  }
}

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
    DbSchemaGuard,
  ],
  exports: [PG_POOL],
})
export class DbModule {}
