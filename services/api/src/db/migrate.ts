import '../config/load-env';
import { Pool } from 'pg';
import { runMigrations } from './migrations';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await runMigrations(pool);
    await pool.query(`
      create or replace function prevent_account_currency_change()
      returns trigger language plpgsql as $function$
      begin
        if new.currency is distinct from old.currency then
          raise exception 'Account currency is immutable' using errcode = '23514';
        end if;
        return new;
      end;
      $function$;
    `);
    await pool.query('drop trigger if exists accounts_currency_immutable on accounts');
    await pool.query(`
      create trigger accounts_currency_immutable
      before update of currency on accounts
      for each row execute function prevent_account_currency_change()
    `);
    process.stdout.write(JSON.stringify({ ...result, currencyGuard: 'installed' }) + '\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
