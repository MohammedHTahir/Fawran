import '../config/load-env';
import { Pool } from 'pg';

/** Prune expired authentication state. Run daily from the deployment scheduler. */
export async function cleanupAuthData(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const challenges = await client.query(
      "delete from otp_challenges where expires_at < now() - interval '1 day'",
    );
    const sendLimits = await client.query(
      "delete from otp_rate_limits where window_started_at < now() - interval '1 day'",
    );
    const verifyLimits = await client.query(
      "delete from otp_verify_rate_limits where window_started_at < now() - interval '1 day'",
    );
    const sessions = await client.query(
      `delete from auth_sessions
       where expires_at < now() - interval '90 days'
          or revoked_at < now() - interval '90 days'`,
    );
    await client.query('commit');
    return {
      otpChallenges: challenges.rowCount ?? 0,
      otpSendLimits: sendLimits.rowCount ?? 0,
      otpVerifyLimits: verifyLimits.rowCount ?? 0,
      authSessions: sessions.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  cleanupAuthData(pool)
    .then((result) => process.stdout.write(JSON.stringify(result) + '\\n'))
    .catch((error) => {
      process.stderr.write(`Authentication cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}\\n`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
