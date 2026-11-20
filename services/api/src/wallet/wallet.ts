import { BadRequestException, Body, Controller, Get, Headers, Inject, NotFoundException, Post, Param, UseGuards, Module, HttpException, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, Length } from 'class-validator';
import { createHash, randomBytes, randomUUID } from 'crypto';
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
  @IsOptional() @IsString() countryCode?: string;
}
class CreatePaymentRequestDto {
  @IsString() toPhone: string;
  @IsInt() @Min(1) @Max(LIMITS.perTransfer) amount: number;
  @IsString() @Length(3, 3) currency: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsString() @Length(0, 140) note?: string;
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
  async wallet(@CurrentUser() u: AuthUser, @Query('currency') requestedCurrency?: string) {
    const currency = (requestedCurrency ?? u.defaultCurrency ?? 'EGP').trim().toUpperCase();
    const market = getMarketByCurrency(currency);
    if (!market) throw new BadRequestException('Unsupported wallet currency');
    const accountId = currency === (u.defaultCurrency ?? 'EGP') ? u.accountId : await this.accountForCurrency(u.id, currency);
    return { accountId, balance: await this.ledger.balance(accountId), currency, unit: 'minor' };
  }

  @Get('transactions')
  async transactions(@CurrentUser() u: AuthUser, @Query('currency') requestedCurrency?: string) {
    const currency = (requestedCurrency ?? u.defaultCurrency ?? 'EGP').trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported wallet currency');
    const accountId = currency === (u.defaultCurrency ?? 'EGP') ? u.accountId : await this.accountForCurrency(u.id, currency);
    return this.ledger.history(accountId);
  }

  @Post('wallet/topup')
  async topup(@CurrentUser() u: AuthUser, @Body() b: TopupDto, @Headers('idempotency-key') key?: string) {
    const egpAccount = u.defaultCurrency === 'EGP' ? u.accountId : await this.accountForCurrency(u.id, 'EGP');
    const k = `${u.id}:topup:EGP:${requireKey(key)}`;
    const fingerprint = createHash('sha256').update(JSON.stringify({
      userId: u.id, amount: b.amount, method: b.method, currency: 'EGP',
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
      return { txnId: attempt.ledger_txn_id, replayed: true, currency: 'EGP', balance: await this.ledger.balance(egpAccount) };
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
      from: SYSTEM_PROVIDER_ACCOUNT, to: egpAccount, amount: b.amount,
      idemKey: k, kind: 'topup', memo: ch.providerRef,
    });
    await this.pool.query(
      `update payment_attempts set status='succeeded', provider_ref=$2, ledger_txn_id=$3, updated_at=now()
       where idempotency_key=$1`,
      [k, ch.providerRef, t.txnId]);
    return { txnId: t.txnId, replayed: t.replayed || reserve.rowCount === 0, currency: 'EGP', balance: await this.ledger.balance(egpAccount) };
  }

  @Post('transfers')
  async transfer(@CurrentUser() u: AuthUser, @Body() b: TransferDto, @Headers('idempotency-key') key?: string) {
    const phone = normalizePhone(b.toPhone, b.countryCode ?? u.countryCode ?? 'EG');
    const currency = (b.currency ?? u.defaultCurrency ?? 'EGP').trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported transfer currency');
    const fromAccount = currency === (u.defaultCurrency ?? 'EGP') ? u.accountId : await this.accountForCurrency(u.id, currency);
    const r = await this.pool.query(
      'select a.id from users x join accounts a on a.owner_id=x.id where x.phone=$1 and a.currency=$2', [phone, currency]);
    if (!r.rows[0]) throw new NotFoundException('Recipient does not have a wallet in this currency');
    const t = await this.ledger.transfer({ from: fromAccount, to: r.rows[0].id, amount: b.amount,
      currency, idemKey: `${u.id}:p2p:${currency}:${requireKey(key)}`, kind: 'p2p', memo: b.note });
    return { txnId: t.txnId, replayed: t.replayed, currency, balance: await this.ledger.balance(fromAccount) };
  }
  @Get('wallet/receive-code')
  async receiveCode(@CurrentUser() u: AuthUser) {
    let result = await this.pool.query("select code from wallet_payment_handles where user_id=$1", [u.id]);
    if (!result.rows[0]) {
      const code = randomBytes(24).toString('base64url');
      await this.pool.query("insert into wallet_payment_handles(user_id,code) values($1,$2) on conflict(user_id) do nothing", [u.id,code]);
      result = await this.pool.query("select code from wallet_payment_handles where user_id=$1", [u.id]);
    }
    const code = result.rows[0]?.code as string;
    return { code, deepLink: "fawran://pay?code=" + encodeURIComponent(code), purpose:"recipient_identification_only" };
  }

  @Get('wallet/resolve/:code')
  async resolveReceiveCode(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw new NotFoundException('Recipient code not found');
    const result = await this.pool.query(
      "select u.id,u.phone,u.default_currency,array_agg(a.currency order by a.currency) as currencies from wallet_payment_handles h join users u on u.id=h.user_id join accounts a on a.owner_id=u.id where h.code=$1 group by u.id,u.phone,u.default_currency", [code]);
    if (!result.rows[0]) throw new NotFoundException('Recipient code not found');
    if (result.rows[0].id === u.id) throw new BadRequestException('You cannot send money to yourself');
    return { recipientPhone:result.rows[0].phone,currency:result.rows[0].default_currency,currencies:result.rows[0].currencies as string[] };
  }

  @Post('wallet/requests')
  async createPaymentRequest(@CurrentUser() u: AuthUser, @Body() b: CreatePaymentRequestDto,
    @Headers('idempotency-key') key?: string) {
    const idem = requireKey(key);
    const phone = normalizePhone(b.toPhone,b.countryCode ?? u.countryCode ?? 'EG');
    const currency = b.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported request currency');
    await this.accountForCurrency(u.id,currency);
    const payer = await this.pool.query(
      "select x.id from users x join accounts a on a.owner_id=x.id where x.phone=$1 and a.currency=$2", [phone,currency]);
    if (!payer.rows[0]) throw new NotFoundException('Payer does not have a wallet in this currency');
    if (payer.rows[0].id === u.id) throw new BadRequestException('You cannot request money from yourself');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      requesterId:u.id,payerId:payer.rows[0].id,amount:b.amount,currency,note:b.note?.trim()||null,
    })).digest('hex');
    const id = randomUUID();
    await this.pool.query(
      "insert into wallet_payment_requests (id,requester_id,payer_id,amount,currency,note,idempotency_key,request_fingerprint,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '24 hours') on conflict(requester_id,idempotency_key) do nothing",
      [id,u.id,payer.rows[0].id,b.amount,currency,b.note?.trim()||null,idem,fingerprint]);
    const saved = await this.pool.query(
      "select id,requester_id,payer_id,amount,currency,note,status,ledger_txn_id,expires_at,created_at,request_fingerprint from wallet_payment_requests where requester_id=$1 and idempotency_key=$2", [u.id,idem]);
    const request = saved.rows[0];
    if (!request || request.request_fingerprint !== fingerprint) throw new BadRequestException('Idempotency key was already used for a different payment request');
    delete request.request_fingerprint;
    return { ...request,amount:Number(request.amount),replayed:request.id !== id };
  }

  @Get('wallet/requests')
  async paymentRequests(@CurrentUser() u: AuthUser) {
    const result = await this.pool.query(
      "select r.id,r.requester_id,r.payer_id,r.amount,r.currency,r.note,r.status,r.ledger_txn_id,r.expires_at,r.created_at,case when r.requester_id=$1 then 'outgoing' else 'incoming' end as direction,case when r.requester_id=$1 then payer.phone else requester.phone end as counterparty_phone from wallet_payment_requests r join users requester on requester.id=r.requester_id join users payer on payer.id=r.payer_id where r.requester_id=$1 or r.payer_id=$1 order by r.created_at desc limit 100", [u.id]);
    return result.rows.map((row:any)=>({...row,amount:Number(row.amount)}));
  }

  @Post('wallet/requests/:id/accept')
  async acceptPaymentRequest(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const found = await this.pool.query("select * from wallet_payment_requests where id=$1 and payer_id=$2", [id,u.id]);
    const request = found.rows[0];
    if (!request) throw new NotFoundException('Payment request not found');
    if (request.status === 'accepted' && request.ledger_txn_id) {
      return {requestId:id,txnId:request.ledger_txn_id,replayed:true,status:'accepted'};
    }
    if (request.status === 'pending' && new Date(request.expires_at).getTime() <= Date.now()) {
      await this.pool.query("update wallet_payment_requests set status='expired',updated_at=now() where id=$1 and status='pending'", [id]);
      throw new BadRequestException('Payment request has expired');
    }
    if (!['pending','processing'].includes(request.status)) {
      throw new BadRequestException('Payment request cannot be accepted from status ' + request.status);
    }
    await this.pool.query("update wallet_payment_requests set status='processing',updated_at=now() where id=$1 and status='pending'", [id]);
    const fromAccount = u.defaultCurrency === request.currency ? u.accountId : await this.accountForCurrency(u.id,request.currency);
    const toAccount = await this.accountForCurrency(request.requester_id,request.currency);
    const transfer = await this.ledger.transfer({
      from:fromAccount,to:toAccount,amount:Number(request.amount),currency:request.currency,
      idemKey:'p2p-request:' + id,kind:'p2p',memo:request.note || 'Accepted payment request',
    });
    await this.pool.query("update wallet_payment_requests set status='accepted',ledger_txn_id=$2,updated_at=now() where id=$1 and status='processing'", [id,transfer.txnId]);
    return {requestId:id,txnId:transfer.txnId,replayed:transfer.replayed,status:'accepted',
      currency:request.currency,balance:await this.ledger.balance(fromAccount)};
  }

  @Post('wallet/requests/:id/decline')
  async declinePaymentRequest(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const result = await this.pool.query(
      "update wallet_payment_requests set status='declined',updated_at=now() where id=$1 and payer_id=$2 and status='pending' returning id,status", [id,u.id]);
    if (!result.rows[0]) throw new NotFoundException('Pending payment request not found');
    return result.rows[0];
  }

  @Post('wallet/requests/:id/cancel')
  async cancelPaymentRequest(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const result = await this.pool.query(
      "update wallet_payment_requests set status='cancelled',updated_at=now() where id=$1 and requester_id=$2 and status='pending' returning id,status",
      [id,u.id]);
    if (!result.rows[0]) throw new NotFoundException('Pending outgoing payment request not found');
    return result.rows[0];
  }

}

@Module({ imports: [AuthModule, ProviderModule], controllers: [WalletController] })
export class WalletModule {}
