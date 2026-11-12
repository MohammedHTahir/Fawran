import { BadRequestException, Body, Controller, Get, Headers, Inject, NotFoundException, Post, UseGuards, Module } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { AuthGuard, AuthModule, AuthUser, CurrentUser, normalizePhone } from '../auth/auth';
import { PG_POOL, SYSTEM_PROVIDER_ACCOUNT } from '../db/db.module';
import { LedgerService } from '../ledger/ledger.service';
import { PAYMENT_PROVIDER, PaymentProvider, PayMethod, ProviderModule } from '../provider/provider';

// Placeholder limits in piasters. Real limits must come from the licensed partner's policy and KYC tier.
export const LIMITS = { perTransfer: 5_000_000, perTopup: 5_000_000 };

class TransferDto {
  @IsString() toPhone: string;
  @IsInt() @Min(1) @Max(LIMITS.perTransfer) amount: number;
  @IsOptional() @IsString() note?: string;
}
class TopupDto {
  @IsInt() @Min(1) @Max(LIMITS.perTopup) amount: number;
  @IsIn(['instapay', 'card', 'wallet']) method: PayMethod;
}

function requireKey(h?: string) {
  if (!h || h.length < 8) throw new BadRequestException('Idempotency-Key header required (min 8 chars)');
  return h;
}

@Controller()
@UseGuards(AuthGuard)
export class WalletController {
  constructor(private ledger: LedgerService, @Inject(PG_POOL) private pool: Pool,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider) {}

  @Get('wallet')
  async wallet(@CurrentUser() u: AuthUser) { return { balance: await this.ledger.balance(u.accountId), currency: 'EGP', unit: 'piaster' }; }

  @Get('transactions')
  transactions(@CurrentUser() u: AuthUser) { return this.ledger.history(u.accountId); }

  @Post('wallet/topup')
  async topup(@CurrentUser() u: AuthUser, @Body() b: TopupDto, @Headers('idempotency-key') key?: string) {
    const k = `${u.id}:topup:${requireKey(key)}`;
    const fingerprint = createHash('sha256').update(JSON.stringify({
      userId: u.id, amount: b.amount, method: b.method,
    })).digest('hex');

    // Fail closed for transactions created by the earlier prototype, which have
    // no request fingerprint and therefore cannot safely be replayed.
    const legacy = await this.pool.query(
      'select id, request_fingerprint from ledger_transactions where idem_key=$1', [k]);
    if (legacy.rows[0] && !legacy.rows[0].request_fingerprint) {
      throw new BadRequestException('This idempotency key belongs to a legacy transaction; contact support before retrying');
    }

    // Persist the intent before contacting the provider. The same stable reference
    // is sent on every retry so a real PSP can deduplicate the external charge.
    const reserve = await this.pool.query(
      `insert into payment_attempts
         (idempotency_key,user_id,request_fingerprint,amount,method,status)
       values ($1,$2,$3,$4,$5,'processing')
       on conflict (idempotency_key) do nothing
       returning idempotency_key`,
      [k, u.id, fingerprint, b.amount, b.method]);
    const existing = await this.pool.query(
      'select user_id,request_fingerprint,amount,method,status,provider_ref,ledger_txn_id from payment_attempts where idempotency_key=$1',
      [k]);
    const attempt = existing.rows[0];
    if (!attempt || attempt.user_id !== u.id || attempt.request_fingerprint !== fingerprint ||
        Number(attempt.amount) !== b.amount || attempt.method !== b.method) {
      throw new BadRequestException('Idempotency key was already used for a different top-up request');
    }
    if (attempt.status === 'failed') throw new BadRequestException('This top-up attempt failed; use a new idempotency key');
    if (attempt.status === 'succeeded' && attempt.ledger_txn_id) {
      return { txnId: attempt.ledger_txn_id, replayed: true, balance: await this.ledger.balance(u.accountId) };
    }

    const ch = await this.provider.charge({ amount: b.amount, method: b.method, reference: k });
    if (!ch.ok) {
      await this.pool.query(
        `update payment_attempts set status='failed', updated_at=now() where idempotency_key=$1`, [k]);
      throw new BadRequestException('Payment declined');
    }

    // Ledger idempotency is independent of the PSP idempotency key. If the process
    // crashes after charging, a retry must receive the same provider result and
    // the ledger must post at most once.
    const t = await this.ledger.transfer({
      from: SYSTEM_PROVIDER_ACCOUNT, to: u.accountId, amount: b.amount,
      idemKey: k, kind: 'topup', memo: ch.providerRef,
    });
    await this.pool.query(
      `update payment_attempts set status='succeeded', provider_ref=$2, ledger_txn_id=$3, updated_at=now()
       where idempotency_key=$1`,
      [k, ch.providerRef, t.txnId]);
    return { txnId: t.txnId, replayed: t.replayed || reserve.rowCount === 0, balance: await this.ledger.balance(u.accountId) };
  }

  @Post('transfers')
  async transfer(@CurrentUser() u: AuthUser, @Body() b: TransferDto, @Headers('idempotency-key') key?: string) {
    const phone = normalizePhone(b.toPhone);
    const r = await this.pool.query(
      `select a.id from users x join accounts a on a.owner_id = x.id where x.phone=$1`, [phone]);
    if (!r.rows[0]) throw new NotFoundException('Recipient is not on Fawran yet');
    const t = await this.ledger.transfer({ from: u.accountId, to: r.rows[0].id, amount: b.amount,
      idemKey: `${u.id}:p2p:${requireKey(key)}`, kind: 'p2p', memo: b.note });
    return { txnId: t.txnId, replayed: t.replayed, balance: await this.ledger.balance(u.accountId) };
  }
}

@Module({ imports: [AuthModule, ProviderModule], controllers: [WalletController] })
export class WalletModule {}
