import { BadRequestException, Body, Controller, Get, Headers, Inject, NotFoundException, Post, UseGuards, Module, HttpException, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { AuthGuard, AuthModule, AuthUser, CurrentUser, normalizePhone } from '../auth/auth';
import { PG_POOL, SYSTEM_PROVIDER_ACCOUNT } from '../db/db.module';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.port';
import { PAYMENT_PROVIDER, PaymentProvider, PayMethod, ProviderModule } from '../provider/provider';
import { getMarketByCurrency } from '../markets/market-registry';

// Temporary test limits in currency minor units; production limits are market/KYC policy. Real limits must come from the licensed partner's policy and KYC tier.
export const LIMITS = { perTransfer: 5_000_000, perTopup: 5_000_000 };

class TransferDto {
  @IsString() toPhone: string;
  @IsInt() @Min(1) @Max(LIMITS.perTransfer) amount: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() currency?: string;
}
class CreateWalletDto {
  @IsString() currency: string;
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
  constructor(@Inject(LEDGER_PORT) private ledger: LedgerPort, @Inject(PG_POOL) private pool: Pool,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider) {}

  private async accountForCurrency(userId: string, currency: string): Promise<string> {
    const result = await this.pool.query(
      'select id from accounts where owner_id=$1 and currency=$2', [userId, currency]);
    if (!result.rows[0]) throw new NotFoundException(`No ${currency} wallet exists for this user`);
    return result.rows[0].id as string;
  }

  @Get('wallets')
  async wallets(@CurrentUser() u: AuthUser) {
    const result = await this.pool.query(
      'select id, currency, balance, created_at from accounts where owner_id=$1 order by currency', [u.id]);
    return result.rows.map((row: any) => ({
      accountId: row.id, currency: row.currency, balance: Number(row.balance), unit: 'minor',
      createdAt: row.created_at,
    }));
  }

  @Post('wallets')
  async createWallet(@CurrentUser() u: AuthUser, @Body() body: CreateWalletDto) {
    const currency = body.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Currency is not in the supported market catalog');
    const existing = await this.pool.query(
      'select id from accounts where owner_id=$1 and currency=$2', [u.id, currency]);
    if (existing.rows[0]) return { accountId: existing.rows[0].id, currency, created: false };
    try {
      const accountId = await this.ledger.createAccount(u.id, 'user', currency);
      return { accountId, currency, created: true };
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      const raced = await this.pool.query(
        'select id from accounts where owner_id=$1 and currency=$2', [u.id, currency]);
      if (!raced.rows[0]) throw error;
      return { accountId: raced.rows[0].id, currency, created: false };
    }
  }

  @Get('wallet')
  async wallet(@CurrentUser() u: AuthUser, @Query('currency') requestedCurrency = 'EGP') {
    const currency = requestedCurrency.trim().toUpperCase();
    const market = getMarketByCurrency(currency);
    if (!market) throw new BadRequestException('Unsupported wallet currency');
    const accountId = currency === 'EGP' ? u.accountId : await this.accountForCurrency(u.id, currency);
    return { accountId, balance: await this.ledger.balance(accountId), currency, unit: 'minor' };
  }

  @Get('transactions')
  async transactions(@CurrentUser() u: AuthUser, @Query('currency') requestedCurrency = 'EGP') {
    const currency = requestedCurrency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported wallet currency');
    const accountId = currency === 'EGP' ? u.accountId : await this.accountForCurrency(u.id, currency);
    return this.ledger.history(accountId);
  }

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
      throw new HttpException('Payment declined', 402);
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
    const currency = (b.currency ?? 'EGP').trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported transfer currency');
    const fromAccount = currency === 'EGP' ? u.accountId : await this.accountForCurrency(u.id, currency);
    const r = await this.pool.query(
      'select a.id from users x join accounts a on a.owner_id=x.id where x.phone=$1 and a.currency=$2', [phone, currency]);
    if (!r.rows[0]) throw new NotFoundException('Recipient does not have a wallet in this currency');
    const t = await this.ledger.transfer({ from: fromAccount, to: r.rows[0].id, amount: b.amount,
      currency, idemKey: `${u.id}:p2p:${currency}:${requireKey(key)}`, kind: 'p2p', memo: b.note });
    return { txnId: t.txnId, replayed: t.replayed, currency, balance: await this.ledger.balance(fromAccount) };
  }
}

@Module({ imports: [AuthModule, ProviderModule], controllers: [WalletController] })
export class WalletModule {}
