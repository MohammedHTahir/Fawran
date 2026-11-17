import { randomBytes, randomUUID, createHash } from 'crypto';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/db.module';

type RewardSystemKind = 'issuance' | 'redemption' | 'expiry';

interface EarnPointsInput {
  userId: string;
  points: number;
  idempotencyKey: string;
  reference?: string;
  expiresAt?: Date | null;
  campaignId?: string | null;
}

@Injectable()
export class RewardsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private tierFor(lifetimePoints: number): 'starter' | 'bronze' | 'silver' | 'gold' {
    if (lifetimePoints >= 50_000) return 'gold';
    if (lifetimePoints >= 10_000) return 'silver';
    if (lifetimePoints >= 1_000) return 'bronze';
    return 'starter';
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async customerAccount(client: PoolClient, userId: string) {
    await client.query(
      "insert into reward_accounts(id,owner_id,kind) values($1,$2,'customer') on conflict(owner_id) do nothing",
      [randomUUID(), userId],
    );
    const result = await client.query(
      "select id,balance_points,lifetime_earned_points,tier from reward_accounts where owner_id=$1 and kind='customer' for update",
      [userId],
    );
    if (!result.rows[0]) throw new NotFoundException('Rewards account could not be created');
    return result.rows[0];
  }

  private async systemAccount(client: PoolClient, kind: RewardSystemKind) {
    await client.query(
      'insert into reward_accounts(id,owner_id,kind) values($1,null,$2) on conflict(id) do nothing',
      [`reward:system:${kind}`, kind],
    );
    const result = await client.query(
      'select id,balance_points from reward_accounts where id=$1 for update',
      [`reward:system:${kind}`],
    );
    if (!result.rows[0]) throw new Error(`Rewards system account ${kind} is unavailable`);
    return result.rows[0];
  }

  private async ensureInviteCode(client: PoolClient, userId: string): Promise<string> {
    await client.query(
      'insert into reward_invite_codes(owner_id,code) values($1,$2) on conflict(owner_id) do nothing',
      [userId, randomBytes(8).toString('hex').toUpperCase()],
    );
    const result = await client.query('select code from reward_invite_codes where owner_id=$1', [userId]);
    if (!result.rows[0]) throw new Error('Unable to create a referral code');
    return String(result.rows[0].code);
  }

  async summary(userId: string) {
    await this.expireDue(100);
    const client = await this.pool.connect();
    let inviteCode: string;
    try {
      await client.query('begin');
      const account = await this.customerAccount(client, userId);
      inviteCode = await this.ensureInviteCode(client, userId);
      await client.query('commit');
      const history = await client.query(
        'select id,kind,points,reference,created_at,expires_at from reward_transactions where owner_id=$1 order by created_at desc limit 20',
        [userId],
      );
      return {
        unit: 'POINTS',
        pointsBalance: Number(account.balance_points),
        lifetimeEarnedPoints: Number(account.lifetime_earned_points),
        tier: account.tier,
        referralCode: inviteCode,
        history: history.rows.map((row: any) => ({
          id: row.id, kind: row.kind, points: Number(row.points), reference: row.reference,
          createdAt: row.created_at, expiresAt: row.expires_at,
        })),
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Internal settlement hook. Never expose this as an unauthenticated client endpoint. */
  async earn(input: EarnPointsInput): Promise<{ transactionId: string; replayed: boolean }> {
    if (input.campaignId) throw new BadRequestException('Campaign reward issuance is disabled until campaign funding controls are approved');
    if (!Number.isSafeInteger(input.points) || input.points <= 0) {
      throw new BadRequestException('Reward points must be a positive safe integer');
    }
    if (!input.idempotencyKey || input.idempotencyKey.length > 512) {
      throw new BadRequestException('Invalid reward idempotency key');
    }
    if (input.expiresAt && (Number.isNaN(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now())) {
      throw new BadRequestException('Reward expiry must be a future date');
    }
    const fingerprint = this.fingerprint({
      userId: input.userId, points: input.points, reference: input.reference ?? null,
      expiresAt: input.expiresAt?.toISOString() ?? null, campaignId: input.campaignId ?? null,
    });
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const proposedTransactionId = randomUUID();
      const existingBeforeInsert = await client.query(
        'select id,request_fingerprint from reward_transactions where idempotency_key=$1', [input.idempotencyKey],
      );
      if (existingBeforeInsert.rows[0]) {
        if (existingBeforeInsert.rows[0].request_fingerprint !== fingerprint) throw new ConflictException('Reward idempotency key was reused for a different request');
        await client.query('commit');
        return { transactionId: String(existingBeforeInsert.rows[0].id), replayed: true };
      }
      const inserted = await client.query(
        `insert into reward_transactions
          (id,idempotency_key,request_fingerprint,owner_id,kind,points,reference,campaign_id,expires_at)
         values($1,$2,$3,$4,'earn',$5,$6,$7,$8)
         on conflict(idempotency_key) do nothing returning id`,
        [proposedTransactionId, input.idempotencyKey, fingerprint, input.userId, input.points,
          input.reference ?? null, input.campaignId ?? null, input.expiresAt ?? null],
      );
      if (!inserted.rows[0] || String(inserted.rows[0].id) !== proposedTransactionId) {
        const existing = await client.query(
          'select id,request_fingerprint from reward_transactions where idempotency_key=$1',
          [input.idempotencyKey],
        );
        if (!existing.rows[0] || existing.rows[0].request_fingerprint !== fingerprint) {
          throw new ConflictException('Reward idempotency key was reused for a different request');
        }
        await client.query('commit');
        return { transactionId: String(existing.rows[0].id), replayed: true };
      }

      const transactionId = String(inserted.rows[0].id);
      const persisted = await client.query('select id from reward_transactions where id=$1', [transactionId]);
      if (!persisted.rows[0]) throw new Error('Reward transaction was not persisted before its ledger entries');
      const customer = await this.customerAccount(client, input.userId);
      const issuance = await this.systemAccount(client, 'issuance');
      const lifetime = Number(customer.lifetime_earned_points) + input.points;
      if (!Number.isSafeInteger(lifetime)) throw new BadRequestException('Lifetime reward points exceed the supported integer range');
      await client.query(
        'update reward_accounts set balance_points=$2,lifetime_earned_points=$3,tier=$4,updated_at=now() where id=$1',
        [customer.id, Number(customer.balance_points) + input.points, lifetime, this.tierFor(lifetime)],
      );
      await client.query(
        'update reward_accounts set balance_points=$2,updated_at=now() where id=$1',
        [issuance.id, Number(issuance.balance_points) - input.points],
      );
      await client.query(
        'insert into reward_entries(id,transaction_id,account_id,points_delta) values($1,$2,$3,$4)',
        [randomUUID(), transactionId, customer.id, input.points],
      );
      await client.query(
        'insert into reward_entries(id,transaction_id,account_id,points_delta) values($1,$2,$3,$4)',
        [randomUUID(), transactionId, issuance.id, -input.points],
      );
      await client.query(
        'insert into reward_lots(id,earn_transaction_id,account_id,points_issued,points_remaining,expires_at) values($1,$2,$3,$4,$4,$5)',
        [randomUUID(), transactionId, customer.id, input.points, input.expiresAt ?? null],
      );
      await client.query('commit');
      return { transactionId, replayed: false };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Redeems points only inside the separate non-cash rewards ledger. */
  async redeem(userId: string, points: number, idempotencyKey: string, reference: string) {
    if (!Number.isSafeInteger(points) || points <= 0) throw new BadRequestException('Points must be a positive safe integer');
    if (!idempotencyKey || idempotencyKey.length > 512) throw new BadRequestException('Invalid reward idempotency key');
    const fingerprint = this.fingerprint({ userId, points, reference });
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const proposedTransactionId = randomUUID();
      const existingBeforeInsert = await client.query(
        'select id,request_fingerprint from reward_transactions where idempotency_key=$1', [idempotencyKey],
      );
      if (existingBeforeInsert.rows[0]) {
        if (existingBeforeInsert.rows[0].request_fingerprint !== fingerprint) throw new ConflictException('Reward idempotency key was reused for a different request');
        await client.query('commit');
        return { transactionId: String(existingBeforeInsert.rows[0].id), replayed: true };
      }
      const inserted = await client.query(
        `insert into reward_transactions(id,idempotency_key,request_fingerprint,owner_id,kind,points,reference)
         values($1,$2,$3,$4,'redeem',$5,$6) on conflict(idempotency_key) do nothing returning id`,
        [proposedTransactionId, idempotencyKey, fingerprint, userId, points, reference],
      );
      if (!inserted.rows[0] || String(inserted.rows[0].id) !== proposedTransactionId) {
        const existing = await client.query(
          'select id,request_fingerprint from reward_transactions where idempotency_key=$1', [idempotencyKey],
        );
        if (!existing.rows[0] || existing.rows[0].request_fingerprint !== fingerprint) {
          throw new ConflictException('Reward idempotency key was reused for a different request');
        }
        await client.query('commit');
        return { transactionId: String(existing.rows[0].id), replayed: true };
      }

      const transactionId = String(inserted.rows[0].id);
      const persisted = await client.query('select id from reward_transactions where id=$1', [transactionId]);
      if (!persisted.rows[0]) throw new Error('Reward transaction was not persisted before its ledger entries');
      const customer = await this.customerAccount(client, userId);
      const redemption = await this.systemAccount(client, 'redemption');
      const lots = await client.query(
        `select id,points_remaining from reward_lots
         where account_id=$1 and points_remaining>0 and (expires_at is null or expires_at>now())
         order by created_at asc for update`,
        [customer.id],
      );
      let remaining = points;
      for (const lot of lots.rows) {
        if (remaining <= 0) break;
        const available = Number(lot.points_remaining);
        const used = Math.min(available, remaining);
        await client.query('update reward_lots set points_remaining=$2 where id=$1', [lot.id, available - used]);
        remaining -= used;
      }
      if (remaining > 0 || Number(customer.balance_points) < points) {
        throw new BadRequestException('Insufficient available reward points');
      }
      await client.query(
        'update reward_accounts set balance_points=$2,updated_at=now() where id=$1',
        [customer.id, Number(customer.balance_points) - points],
      );
      await client.query(
        'update reward_accounts set balance_points=$2,updated_at=now() where id=$1',
        [redemption.id, Number(redemption.balance_points) + points],
      );
      await client.query(
        'insert into reward_entries(id,transaction_id,account_id,points_delta) values($1,$2,$3,$4)',
        [randomUUID(), transactionId, customer.id, -points],
      );
      await client.query(
        'insert into reward_entries(id,transaction_id,account_id,points_delta) values($1,$2,$3,$4)',
        [randomUUID(), transactionId, redemption.id, points],
      );
      await client.query('commit');
      return { transactionId, replayed: false };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Expires unspent points in FIFO lots. Safe to call repeatedly from a worker. */
  async expireDue(limit = 100): Promise<{ lotsExpired: number; pointsExpired: number }> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const expiry = await this.systemAccount(client, 'expiry');
      const due = await client.query(
        `select l.id,l.account_id,a.owner_id
         from reward_lots l join reward_accounts a on a.id=l.account_id
         where l.points_remaining>0 and l.expires_at is not null and l.expires_at<=now()
         order by l.expires_at asc limit $1`,
        [safeLimit],
      );
      let pointsExpired = 0;
      let lotsExpired = 0;
      let expiryBalance = Number(expiry.balance_points);
      for (const lot of due.rows) {
        await client.query('select id from reward_accounts where id=$1 for update', [lot.account_id]);
        const currentLot = await client.query(
          'select points_remaining from reward_lots where id=$1 for update', [lot.id],
        );
        const points = Number(currentLot.rows[0]?.points_remaining ?? 0);
        if (points <= 0) continue;
        const proposedTransactionId = randomUUID();
        const idempotencyKey = `reward-expiry:${lot.id}`;
        const fingerprint = this.fingerprint({ lotId: lot.id, points });
        const inserted = await client.query(
          `insert into reward_transactions(id,idempotency_key,request_fingerprint,owner_id,kind,points,reference)
           values($1,$2,$3,$4,'expire',$5,$6) on conflict(idempotency_key) do nothing returning id`,
          [proposedTransactionId, idempotencyKey, fingerprint, lot.owner_id, points, String(lot.id)],
        );
        if (!inserted.rows[0] || String(inserted.rows[0].id) !== proposedTransactionId) continue;
        const transactionId = String(inserted.rows[0].id);
        await client.query('update reward_lots set points_remaining=0 where id=$1', [lot.id]);
        const customerBalance = await client.query('select balance_points from reward_accounts where id=$1', [lot.account_id]);
        await client.query(
          'update reward_accounts set balance_points=$2,updated_at=now() where id=$1',
          [lot.account_id, Number(customerBalance.rows[0].balance_points) - points],
        );
        expiryBalance += points;
        await client.query(
          'update reward_accounts set balance_points=$2,updated_at=now() where id=$1',
          [expiry.id, expiryBalance],
        );
        await client.query(
          'insert into reward_entries(id,transaction_id,account_id,points_delta) values($1,$2,$3,$4)',
          [randomUUID(), transactionId, lot.account_id, -points],
        );
        await client.query(
          'insert into reward_entries(id,transaction_id,account_id,points_delta) values($1,$2,$3,$4)',
          [randomUUID(), transactionId, expiry.id, points],
        );
        pointsExpired += points;
        lotsExpired += 1;
      }
      await client.query('commit');
      return { lotsExpired, pointsExpired };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Called by a trusted payment-settlement workflow after the invitee qualifies. */
  async qualifyReferral(inviteeUserId: string, rewardPoints = 500) {
    if (!Number.isSafeInteger(rewardPoints) || rewardPoints <= 0) {
      throw new BadRequestException('Referral reward must be a positive safe integer');
    }
    const client = await this.pool.connect();
    let referral: any;
    try {
      await client.query('begin');
      const result = await client.query(
        "select id,inviter_user_id,status from reward_referrals where invitee_user_id=$1 and status in ('pending','qualified') for update",
        [inviteeUserId],
      );
      if (!result.rows[0]) {
        await client.query('commit');
        return { rewarded: false };
      }
      referral = result.rows[0];
      if (referral.status === 'pending') {
        await client.query(
          "update reward_referrals set status='qualified',qualified_at=now() where id=$1",
          [referral.id],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // Each side has a distinct idempotency key. A retry after a partial failure
    // safely replays the completed side and finishes the other.
    await this.earn({
      userId: String(referral.inviter_user_id), points: rewardPoints,
      idempotencyKey: `referral:${referral.id}:inviter`, reference: `referral:${referral.id}`,
    });
    await this.earn({
      userId: inviteeUserId, points: rewardPoints,
      idempotencyKey: `referral:${referral.id}:invitee`, reference: `referral:${referral.id}`,
    });
    await this.pool.query(
      "update reward_referrals set status='rewarded',rewarded_at=coalesce(rewarded_at,now()) where id=$1 and status='qualified'",
      [referral.id],
    );
    return { rewarded: true, referralId: String(referral.id), pointsPerUser: rewardPoints };
  }

  async claimReferral(userId: string, code: string) {
    const normalized = code.trim().toUpperCase();
    const invite = await this.pool.query('select owner_id from reward_invite_codes where code=$1', [normalized]);
    if (!invite.rows[0]) throw new NotFoundException('Referral code not found');
    const inviterId = String(invite.rows[0].owner_id);
    if (inviterId === userId) throw new BadRequestException('You cannot claim your own referral code');
    const inserted = await this.pool.query(
      `insert into reward_referrals(id,code,inviter_user_id,invitee_user_id)
       values($1,$2,$3,$4) on conflict(invitee_user_id) do nothing returning id,status`,
      [randomUUID(), normalized, inviterId, userId],
    );
    if (inserted.rows[0]) return { referralId: inserted.rows[0].id, status: inserted.rows[0].status };
    const existing = await this.pool.query(
      'select id,status from reward_referrals where invitee_user_id=$1', [userId],
    );
    return { referralId: existing.rows[0]?.id, status: existing.rows[0]?.status, alreadyClaimed: true };
  }
}
