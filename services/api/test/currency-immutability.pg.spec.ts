import { randomUUID } from 'crypto';
import { Pool } from 'pg';

const integration = Boolean(process.env.DATABASE_URL);
(integration ? describe : describe.skip)('PostgreSQL currency immutability', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('installs a database trigger that prevents changing an account currency', async () => {
    const trigger = await pool.query(
      "select tgname from pg_trigger where tgname='accounts_currency_immutable' and not tgisinternal",
    );
    expect(trigger.rows).toHaveLength(1);

    const id = randomUUID();
    await pool.query(
      "insert into accounts(id,kind,currency) values($1,'test','EGP')", [id],
    );
    await expect(pool.query(
      "update accounts set currency='AED' where id=$1", [id],
    )).rejects.toThrow(/immutable/i);
    const saved = await pool.query('select currency from accounts where id=$1', [id]);
    expect(saved.rows[0].currency).toBe('EGP');
    await pool.query('delete from accounts where id=$1', [id]);
  });
});
