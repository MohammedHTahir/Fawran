import { createHash, randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { getMarketByCurrency } from '../markets/market-registry';

@Injectable()
export class FxQuoteService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async upsertTestRate(actorId: string, input: {
    fromCurrency: string; toCurrency: string; rateNumerator: number; rateDenominator: number;
    feeBps: number; sourceLabel: string;
  }) {
    this.assertTestEnvironment();
    const fromCurrency = input.fromCurrency.trim().toUpperCase();
    const toCurrency = input.toCurrency.trim().toUpperCase();
    if (!getMarketByCurrency(fromCurrency) || !getMarketByCurrency(toCurrency) || fromCurrency === toCurrency) {
      throw new BadRequestException('FX test rate requires two different supported currencies');
    }
    if (!Number.isSafeInteger(input.rateNumerator) || input.rateNumerator <= 0 ||
        !Number.isSafeInteger(input.rateDenominator) || input.rateDenominator <= 0 ||
        !Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 10000) {
      throw new BadRequestException('Invalid FX test rate or fee');
    }
    const sourceLabel = 'test:' + input.sourceLabel.trim();
    await this.pool.query(
      `insert into test_fx_rates(from_currency,to_currency,rate_numerator,rate_denominator,fee_bps,source_label,active,updated_by)
       values($1,$2,$3,$4,$5,$6,true,$7)
       on conflict(from_currency,to_currency) do update set rate_numerator=excluded.rate_numerator,
         rate_denominator=excluded.rate_denominator,fee_bps=excluded.fee_bps,source_label=excluded.source_label,
         active=true,updated_by=excluded.updated_by,updated_at=now()`,
      [fromCurrency, toCurrency, input.rateNumerator, input.rateDenominator, input.feeBps, sourceLabel, actorId],
    );
    await this.audit(actorId, 'fx.test_rate_configured', 'test_fx_rate', fromCurrency + ':' + toCurrency, {
      rateNumerator: input.rateNumerator, rateDenominator: input.rateDenominator, feeBps: input.feeBps, sourceLabel,
    });
    return { fromCurrency, toCurrency, rateNumerator: input.rateNumerator, rateDenominator: input.rateDenominator,
      feeBps: input.feeBps, sourceLabel, testOnly: true, executable: false, realMoney: false };
  }

  async createQuote(userId: string, input: {
    fromCurrency: string; toCurrency: string; amountMinor: number; idempotencyKey: string;
  }) {
    this.assertTestEnvironment();
    const fromCurrency = input.fromCurrency.trim().toUpperCase();
    const toCurrency = input.toCurrency.trim().toUpperCase();
    const fromMarket = getMarketByCurrency(fromCurrency);
    const toMarket = getMarketByCurrency(toCurrency);
    if (!fromMarket || !toMarket || fromCurrency === toCurrency) {
      throw new BadRequestException('Choose two different supported currencies');
    }
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException('Source amount must be a positive integer in minor units');
    }
    const idempotencyKey = userId + ':fx-test:' + input.idempotencyKey;
    const fingerprint = createHash('sha256').update(JSON.stringify({
      userId, fromCurrency, toCurrency, amountMinor: input.amountMinor,
    })).digest('hex');
    const existing = await this.pool.query(
      'select * from fx_quotes where idempotency_key=$1', [idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== fingerprint) {
        throw new ConflictException('Idempotency key was already used for a different FX quote');
      }
      return this.present(existing.rows[0]);
    }

    const rateResult = await this.pool.query(
      'select rate_numerator,rate_denominator,fee_bps,source_label from test_fx_rates where from_currency=$1 and to_currency=$2 and active=true',
      [fromCurrency, toCurrency],
    );
    const rate = rateResult.rows[0];
    if (!rate) throw new ConflictException('No test FX rate is configured for this currency pair');

    const sourceScale = 10n ** BigInt(fromMarket.currencyMinorUnit);
    const targetScale = 10n ** BigInt(toMarket.currencyMinorUnit);
    const numerator = BigInt(input.amountMinor) * BigInt(rate.rate_numerator) * targetScale;
    const denominator = BigInt(rate.rate_denominator) * sourceScale;
    const grossTarget = (numerator + denominator / 2n) / denominator;
    const feeTarget = (grossTarget * BigInt(rate.fee_bps) + 5000n) / 10000n;
    const netTarget = grossTarget - feeTarget;
    if (grossTarget > BigInt(Number.MAX_SAFE_INTEGER) || feeTarget > BigInt(Number.MAX_SAFE_INTEGER) ||
        netTarget > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new BadRequestException('FX quote exceeds the supported safe integer range');
    }
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await this.pool.query(
      `insert into fx_quotes(id,user_id,from_currency,to_currency,source_amount_minor,gross_target_amount_minor,
        fee_target_amount_minor,net_target_amount_minor,rate_numerator,rate_denominator,fee_bps,rate_source,
        idempotency_key,request_fingerprint,expires_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, userId, fromCurrency, toCurrency, input.amountMinor, grossTarget.toString(), feeTarget.toString(),
        netTarget.toString(), rate.rate_numerator, rate.rate_denominator, rate.fee_bps, rate.source_label,
        idempotencyKey, fingerprint, expiresAt.toISOString()],
    );
    return {
      quoteId: id, fromCurrency, toCurrency, sourceAmountMinor: input.amountMinor,
      grossTargetAmountMinor: Number(grossTarget), feeTargetAmountMinor: Number(feeTarget),
      netTargetAmountMinor: Number(netTarget), rateNumerator: Number(rate.rate_numerator),
      rateDenominator: Number(rate.rate_denominator), feeBps: Number(rate.fee_bps),
      rateSource: rate.source_label, status: 'quoted', expiresAt: expiresAt.toISOString(),
      testOnly: true, executable: false, realMoney: false, ledgerPosted: false,
    };
  }

  async getQuote(userId: string, quoteId: string) {
    const result = await this.pool.query('select * from fx_quotes where id=$1 and user_id=$2', [quoteId, userId]);
    if (!result.rows[0]) throw new NotFoundException('FX quote not found');
    const row = result.rows[0];
    if (row.status === 'quoted' && new Date(row.expires_at).getTime() <= Date.now()) {
      await this.pool.query("update fx_quotes set status='expired' where id=$1 and status='quoted'", [quoteId]);
      row.status = 'expired';
    }
    return this.present(row);
  }

  private present(row: Record<string, any>) {
    const expired = row.status === 'quoted' && new Date(row.expires_at).getTime() <= Date.now();
    return {
      quoteId: row.id, fromCurrency: row.from_currency, toCurrency: row.to_currency,
      sourceAmountMinor: Number(row.source_amount_minor),
      grossTargetAmountMinor: Number(row.gross_target_amount_minor),
      feeTargetAmountMinor: Number(row.fee_target_amount_minor),
      netTargetAmountMinor: Number(row.net_target_amount_minor),
      rateNumerator: Number(row.rate_numerator), rateDenominator: Number(row.rate_denominator),
      feeBps: Number(row.fee_bps), rateSource: row.rate_source,
      status: expired ? 'expired' : row.status, expiresAt: new Date(row.expires_at).toISOString(),
      testOnly: true, executable: false, realMoney: false, ledgerPosted: false,
    };
  }

  private assertTestEnvironment() {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('FX test fixtures are disabled in production');
  }

  private async audit(actorId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
    await this.pool.query(
      'insert into admin_audit_events(id,actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5,$6::jsonb)',
      [randomUUID(), actorId, action, entityType, entityId, JSON.stringify(details)],
    );
  }
}
