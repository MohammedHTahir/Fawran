import { INestApplication } from '@nestjs/common';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { RewardsService } from '../src/rewards/rewards.service';
import { PG_POOL } from '../src/db/db.module';
import { makeApp } from './helpers';

describe('RewardsService', () => {
  let app: INestApplication;
  let pool: any;
  let rewards: RewardsService;

  beforeEach(async () => {
    const created = await makeApp();
    app = created.app;
    pool = created.pool;
    rewards = app.get(RewardsService);
    await pool.query('insert into users(id,phone) values($1,$2),($3,$4)',
      ['reward-user-1','01012345678','reward-user-2','01012345679']);
  });

  afterEach(async () => {
    await app.close();
  });

  it('earns points idempotently and records balanced point-ledger entries', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const earned = await rewards.earn({
      userId: 'reward-user-1', points: 1200, idempotencyKey: 'purchase:order-1001',
      reference: 'order-1001', expiresAt,
    });
    const replay = await rewards.earn({
      userId: 'reward-user-1', points: 1200, idempotencyKey: 'purchase:order-1001',
      reference: 'order-1001', expiresAt,
    });
    expect(earned.replayed).toBe(false);
    expect(replay).toMatchObject({ transactionId: earned.transactionId, replayed: true });
    const summary = await rewards.summary('reward-user-1');
    expect(summary).toMatchObject({ unit: 'POINTS', pointsBalance: 1200, lifetimeEarnedPoints: 1200, tier: 'bronze' });
    const entries = await pool.query(
      'select sum(points_delta)::bigint as total from reward_entries where transaction_id=$1',
      [earned.transactionId],
    );
    expect(Number(entries.rows[0].total)).toBe(0);
    await expect(rewards.earn({
      userId: 'reward-user-1', points: 1201, idempotencyKey: 'purchase:order-1001',
      reference: 'order-1001',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('redeems only available points and prevents a negative points balance', async () => {
    await rewards.earn({
      userId: 'reward-user-1', points: 100, idempotencyKey: 'earn:redeem-test',
      reference: 'test',
    });
    const redeemed = await rewards.redeem('reward-user-1', 40, 'redeem:offer-1', 'offer-1');
    expect(redeemed.replayed).toBe(false);
    await expect(rewards.redeem('reward-user-1', 61, 'redeem:offer-2', 'offer-2'))
      .rejects.toBeInstanceOf(BadRequestException);
    const summary = await rewards.summary('reward-user-1');
    expect(summary.pointsBalance).toBe(60);
    expect(summary.history.some((row: any) => row.kind === 'redeem' && row.points === 40)).toBe(true);
  });

  it('expires only unspent points from an expired reward lot', async () => {
    const earned = await rewards.earn({
      userId: 'reward-user-1', points: 90, idempotencyKey: 'earn:expiry-test',
      reference: 'expiry-test', expiresAt: new Date(Date.now() + 60_000),
    });
    await rewards.redeem('reward-user-1', 20, 'redeem:expiry-test', 'expiry-test');
    await pool.query(
      "update reward_lots set expires_at=now()-interval '1 day' where earn_transaction_id=$1",
      [earned.transactionId],
    );
    const expired = await rewards.expireDue();
    expect(expired).toMatchObject({ lotsExpired: 1, pointsExpired: 70 });
    expect((await rewards.summary('reward-user-1')).pointsBalance).toBe(0);
  });

  it('issues stable referral codes and prevents self-referral or duplicate claims', async () => {
    const first = await rewards.summary('reward-user-1');
    const second = await rewards.summary('reward-user-1');
    expect(first.referralCode).toBe(second.referralCode);
    const claim = await rewards.claimReferral('reward-user-2', first.referralCode);
    expect(claim.status).toBe('pending');
    const qualification = await rewards.qualifyReferral('reward-user-2', 250);
    expect(qualification).toMatchObject({ rewarded: true, pointsPerUser: 250 });
    expect((await rewards.summary('reward-user-1')).pointsBalance).toBe(250);
    expect((await rewards.summary('reward-user-2')).pointsBalance).toBe(250);
    expect(await rewards.qualifyReferral('reward-user-2', 250)).toMatchObject({ rewarded: false });
    expect((await rewards.claimReferral('reward-user-2', first.referralCode)).alreadyClaimed).toBe(true);
    await expect(rewards.claimReferral('reward-user-1', first.referralCode))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
