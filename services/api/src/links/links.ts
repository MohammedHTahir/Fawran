import { Body, ConflictException, Controller, Get, HttpException, Inject, Injectable, Module,
  NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AuthGuard, AuthModule, AuthUser, CurrentUser } from '../auth/auth';
import { PG_POOL, SYSTEM_PROVIDER_ACCOUNT } from '../db/db.module';
import { LedgerService } from '../ledger/ledger.service';
import { PAYMENT_PROVIDER, PaymentProvider, PayMethod, ProviderModule } from '../provider/provider';

class CreateLinkDto {
  @IsInt() @Min(100) @Max(5_000_000) amount: number;
  @IsOptional() @IsString() description?: string;
}
class PayDto { @IsIn(['instapay', 'card', 'wallet']) method: PayMethod; }

@Injectable()
export class LinksService {
  constructor(@Inject(PG_POOL) private pool: Pool, private ledger: LedgerService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider) {}

  async create(u: AuthUser, b: CreateLinkDto) {
    const code = randomBytes(6).toString('base64url');
    await this.pool.query(
      'insert into payment_links (id, code, merchant_account, amount, description) values ($1,$2,$3,$4,$5)',
      [randomUUID(), code, u.accountId, b.amount, b.description ?? null]);
    return { code, amount: b.amount, description: b.description ?? null, status: 'open' };
  }

  /** Public: what a payer sees. Never exposes the merchant's account id. */
  async get(code: string) {
    const r = await this.pool.query('select code, amount, description, status from payment_links where code=$1', [code]);
    if (!r.rows[0]) throw new NotFoundException();
    return { ...r.rows[0], amount: Number(r.rows[0].amount) };
  }

  /** Public: payer without an app/account pays via the provider; funds land in the merchant's wallet. */
  async pay(code: string, method: PayMethod) {
    // Claim the link atomically so two payers can't both pay it.
    const claim = await this.pool.query(
      `update payment_links set status='processing' where code=$1 and status='open' returning id, merchant_account, amount`, [code]);
    const link = claim.rows[0];
    if (!link) {
      const exists = await this.pool.query('select status from payment_links where code=$1', [code]);
      if (!exists.rows[0]) throw new NotFoundException();
      throw new ConflictException(`Link is ${exists.rows[0].status}`);
    }
    const amount = Number(link.amount);
    const ch = await this.provider.charge({ amount, method, reference: `link:${link.id}` });
    if (!ch.ok) {
      await this.pool.query(`update payment_links set status='open' where id=$1`, [link.id]);
      throw new HttpException('Payment declined', 402);
    }
    // If this fails after a successful charge the link stays 'processing' for manual/automated reconciliation.
    const t = await this.ledger.transfer({ from: SYSTEM_PROVIDER_ACCOUNT, to: link.merchant_account, amount,
      idemKey: `link:${link.id}`, kind: 'link_payment', memo: ch.providerRef });
    await this.pool.query(`update payment_links set status='paid', paid_txn=$2 where id=$1`, [link.id, t.txnId]);
    return { status: 'paid', txnId: t.txnId };
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
