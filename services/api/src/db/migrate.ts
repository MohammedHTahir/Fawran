import '../config/load-env';
import { Pool } from 'pg';
import { runMigrations } from './migrations';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await runMigrations(pool);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
