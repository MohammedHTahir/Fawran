import { Body, ConflictException, Controller, Get, HttpException, Inject, Injectable, Module,
  NotFoundException, Param, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { randomBytes, randomUUID } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthGuard, AuthModule, AuthUser, CurrentUser } from '../auth/auth';
import { PG_POOL, systemProviderAccount } from '../db/db.module';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.port';
import { PAYMENT_PROVIDER, PaymentProvider, PayMethod, ProviderModule } from '../provider/provider';
import { getMarketByCurrency } from '../markets/market-registry';

class CreateLinkDto {
  @IsInt() @Min(1) @Max(5_000_000) amount: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() currency?: string;
}
class PayDto { @IsIn(['instapay', 'card', 'wallet']) method: PayMethod; }

@Injectable()
export class LinksService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(LEDGER_PORT) private ledger: LedgerPort,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider) {}

  async create(u: AuthUser, b: CreateLinkDto) {
    const currency = (b.currency ?? u.defaultCurrency ?? 'EGP').trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported payment-link currency');
    const account = currency === (u.defaultCurrency ?? 'EGP')
      ? { id: u.accountId }
      : (await this.pool.query('select id from accounts where owner_id=$1 and currency=$2', [u.id, currency])).rows[0];
    if (!account) throw new NotFoundException(`Create a ${currency} wallet before creating a payment link`);
    const code = randomBytes(6).toString('base64url');
    await this.pool.query(
      'insert into payment_links (id, code, merchant_account, amount, description, currency) values ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), code, account.id, b.amount, b.description ?? null, currency]);
    return { code, amount: b.amount, currency, description: b.description ?? null, status: 'open', testOnly: true };
  }

  /** Public: what a payer sees. Never exposes the merchant's account id. */
  async get(code: string) {
    const r = await this.pool.query('select l.code,l.amount,l.description,l.status,l.currency,m.display_name as merchant_name from payment_links l left join merchants m on m.id=l.merchant_id where l.code=$1', [code]);
    if (!r.rows[0]) throw new NotFoundException();
    return { ...r.rows[0], amount: Number(r.rows[0].amount) };
  }

  /** Public: payer without an app/account pays via the provider; funds land in the merchant's wallet. */
  async pay(code: string, method: PayMethod) {
    const metadata = await this.pool.query(
      `select l.id,l.currency,l.merchant_id,m.status as merchant_status,m.kyb_status,ma.settlement_status
       from payment_links l left join merchants m on m.id=l.merchant_id
       left join merchant_accounts ma on ma.ledger_account_id=l.merchant_account where l.code=$1`, [code]);
    if (!metadata.rows[0]) throw new NotFoundException();
    if (metadata.rows[0].merchant_id &&
        (metadata.rows[0].merchant_status !== 'active' || metadata.rows[0].kyb_status !== 'approved')) {
      throw new ForbiddenException('Merchant KYB approval is required before checkout');
    }
    if (metadata.rows[0].merchant_id && metadata.rows[0].settlement_status !== 'enabled') {
      throw new ConflictException('Merchant settlement is blocked pending licensed partner and market approvals');
    }
    // Claim the link atomically so two payers can't both pay it.
    const claim = await this.pool.query(
      `update payment_links set status='processing' where code=$1 and status='open' returning id, merchant_account, amount, currency`, [code]);
    let link = claim.rows[0];
    if (!link) {
      // A previous request may have charged the PSP but timed out before the
      // ledger post completed. Re-enter only the processing state with the same
      // stable provider/ledger references; the PSP adapter must deduplicate them.
      const existing = await this.pool.query(
        `select id, merchant_account, amount, currency, status from payment_links where code=$1`, [code]);
      if (!existing.rows[0]) throw new NotFoundException();
      if (existing.rows[0].status !== 'processing') {
        throw new ConflictException(`Link is ${existing.rows[0].status}`);
      }
      link = existing.rows[0];
    }
    const amount = Number(link.amount);
    const ch = await this.provider.charge({ amount, currency: link.currency, method, reference: `link:${link.id}` });
    if (!ch.ok) {
      await this.pool.query(`update payment_links set status='open' where id=$1`, [link.id]);
      throw new HttpException('Payment declined', 402);
    }
    // If this fails after a successful charge the link stays 'processing' for manual/automated reconciliation.
    const t = await this.ledger.transfer({ from: systemProviderAccount(link.currency), to: link.merchant_account, amount,
      currency: link.currency, idemKey: `link:${link.id}`, kind: 'link_payment', memo: ch.providerRef });
    await this.pool.query(`update payment_links set status='paid', paid_txn=$2 where id=$1`, [link.id, t.txnId]);
    return { status: 'paid', txnId: t.txnId, currency: link.currency, testOnly: true, realMoney: false };
  }
}

@Controller('links')
export class LinksController {
  constructor(private svc: LinksService) {}
  @Post() @UseGuards(AuthGuard) create(@CurrentUser() u: AuthUser, @Body() b: CreateLinkDto) { return this.svc.create(u, b); }
  @Get(':code') get(@Param('code') c: string) { return this.svc.get(c); }
  @Post(':code/pay') pay(@Param('code') c: string, @Body() b: PayDto) { return this.svc.pay(c, b.method); }
}

@Module({ imports: [AuthModule, ProviderModule], controllers: [LinksController], providers: [LinksService] })
export class LinksModule {}
