import { createHash, randomUUID } from 'crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { canMoveRealMoney, getMarketProfile, getMarketByCurrency } from '../markets/market-registry';

export interface TestSettlementLine {
  providerRef: string;
  lineType: 'charge' | 'refund' | 'payout';
  grossAmountMinor: number;
  feeAmountMinor: number;
  netAmountMinor: number;
  currency: string;
}

@Injectable()
export class SettlementService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createTestRefund(userId: string, input: {
    paymentIntentId: string; amountMinor: number; currency: string; reason: string; idempotencyKey: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const intentResult = await client.query(
        'select id,user_id,amount,currency,status,provider_name,ledger_txn_id from payment_intents where id=$1 for update',
        [input.paymentIntentId],
      );
      const intent = intentResult.rows[0];
      if (!intent || intent.user_id !== userId) throw new NotFoundException('Payment intent not found');
      if (intent.provider_name !== 'test' || intent.status !== 'succeeded' || intent.ledger_txn_id) {
        throw new ConflictException('Only succeeded, unposted test-provider intents can be refunded in the test environment');
      }
      if (intent.currency !== input.currency || !Number.isSafeInteger(input.amountMinor) ||
          input.amountMinor <= 0 || input.amountMinor > Number(intent.amount)) {
        throw new BadRequestException('Refund amount and currency must be valid for the original test payment');
      }
      const idem = userId + ':test-refund:' + input.idempotencyKey;
      const fingerprint = createHash('sha256').update(JSON.stringify({
        userId, paymentIntentId: input.paymentIntentId, amountMinor: input.amountMinor,
        currency: input.currency, reason: input.reason.trim(),
      })).digest('hex');
      const existing = await client.query(
        'select id,request_fingerprint,status,amount,currency,provider_ref from payment_refunds where idempotency_key=$1',
        [idem],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== fingerprint) throw new ConflictException('Idempotency key was already used for a different refund');
        await client.query('commit');
        return { refundId: existing.rows[0].id, status: existing.rows[0].status, amountMinor: Number(existing.rows[0].amount),
          currency: existing.rows[0].currency, providerRef: existing.rows[0].provider_ref,
          testMode: true, realMoney: false, ledgerPosted: false };
      }
      const total = await client.query(
        "select coalesce(sum(amount),0)::bigint as total from payment_refunds where payment_intent_id=$1 and status not in ('failed')",
        [input.paymentIntentId],
      );
      if (Number(total.rows[0].total) + input.amountMinor > Number(intent.amount)) {
        throw new ConflictException('Cumulative test refunds cannot exceed the original payment amount');
      }
      const refundId = randomUUID();
      const providerRef = 'test_refund_' + createHash('sha256').update(refundId).digest('hex').slice(0, 24);
      await client.query(
        `insert into payment_refunds(id,payment_intent_id,user_id,amount,currency,idempotency_key,request_fingerprint,status,provider_name,provider_ref)
         values($1,$2,$3,$4,$5,$6,$7,'created','test',$8)`,
        [refundId, input.paymentIntentId, userId, input.amountMinor, input.currency, idem, fingerprint, providerRef],
      );
      await client.query('commit');
      return { refundId, status: 'created', amountMinor: input.amountMinor, currency: input.currency,
        providerRef, testMode: true, realMoney: false, ledgerPosted: false };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async createBlockedTestPayout(userId: string, merchantId: string, input: {
    amountMinor: number; currency: string; idempotencyKey: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const membership = await client.query(
        'select m.id,m.country_code,m.currency,mm.role from merchants m join merchant_members mm on mm.merchant_id=m.id where m.id=$1 and mm.user_id=$2',
        [merchantId, userId],
      );
      if (!membership.rows[0]) throw new NotFoundException('Merchant not found');
      if (!['owner','admin'].includes(membership.rows[0].role)) throw new ForbiddenException('Merchant owner or admin permission required');
      if (membership.rows[0].currency !== input.currency || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
        throw new BadRequestException('Payout currency and amount must match the merchant account');
      }
      const market = getMarketProfile(membership.rows[0].country_code);
      if (!market) throw new BadRequestException('Merchant market is not in the approved planning catalog');
      const enabled = canMoveRealMoney(market.countryCode);
      const idem = merchantId + ':test-payout:' + input.idempotencyKey;
      const fingerprint = createHash('sha256').update(JSON.stringify({
        merchantId, userId, amountMinor: input.amountMinor, currency: input.currency,
      })).digest('hex');
      const existing = await client.query(
        'select id,request_fingerprint,status,amount,currency,failure_code from payout_requests where idempotency_key=$1',
        [idem],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== fingerprint) throw new ConflictException('Idempotency key was already used for a different payout request');
        await client.query('commit');
        return { payoutId: existing.rows[0].id, status: existing.rows[0].status, amountMinor: Number(existing.rows[0].amount),
          currency: existing.rows[0].currency, blockedReason: existing.rows[0].failure_code,
          testMode: true, realMoney: false, payoutSent: false };
      }
      const payoutId = randomUUID();
      const status = enabled ? 'blocked' : 'blocked';
      const reason = enabled ? 'test_provider_execution_not_implemented' : 'real_money_disabled_pending_approvals';
      await client.query(
        `insert into payout_requests(id,merchant_id,requested_by,amount,currency,idempotency_key,request_fingerprint,status,failure_code)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [payoutId, merchantId, userId, input.amountMinor, input.currency, idem, fingerprint, status, reason],
      );
      await client.query(
        `insert into admin_audit_events(id,actor_user_id,action,entity_type,entity_id,details)
         values($1,$2,'merchant.test_payout_requested','payout_request',$3,$4::jsonb)`,
        [randomUUID(), userId, payoutId, JSON.stringify({ merchantId, amountMinor: input.amountMinor, currency: input.currency, status, reason })],
      );
      await client.query('commit');
      return { payoutId, status, amountMinor: input.amountMinor, currency: input.currency,
        blockedReason: reason, testMode: true, realMoney: false, payoutSent: false };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async importTestSettlement(userId: string, input: {
    batchId: string; currency: string; settlementDate: string; lines: TestSettlementLine[];
  }) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Test settlement import is disabled in production');
    const currency = input.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported settlement currency');
    if (!Number.isFinite(Date.parse(input.settlementDate))) throw new BadRequestException('Invalid settlement date');
    for (const line of input.lines) {
      if (!getMarketByCurrency(line.currency) || !Number.isSafeInteger(line.grossAmountMinor) ||
          !Number.isSafeInteger(line.feeAmountMinor) || !Number.isSafeInteger(line.netAmountMinor)) {
        throw new BadRequestException('Settlement line contains unsupported currency or invalid minor-unit amounts');
      }
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...input, currency })).digest('hex');
    const client = await this.pool.connect();
    let batchId: string;
    try {
      await client.query('begin');
      const existing = await client.query(
        'select id,request_fingerprint from settlement_batches where provider_name=$1 and external_batch_id=$2 for update',
        ['test', input.batchId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_fingerprint !== fingerprint) throw new ConflictException('Settlement batch ID was reused with different contents');
        batchId = existing.rows[0].id;
        await client.query('commit');
        return this.getTestSettlement(batchId);
      }
      batchId = randomUUID();
      const inserted = await client.query(
        `insert into settlement_batches(id,provider_name,external_batch_id,request_fingerprint,currency,settlement_date,imported_by,status)
         values($1,'test',$2,$3,$4,$5,$6,'imported') on conflict(provider_name,external_batch_id) do nothing returning id`,
        [batchId, input.batchId, fingerprint, currency, input.settlementDate, userId],
      );
      if (!inserted.rows[0]) {
        const raced = await client.query(
          'select id,request_fingerprint from settlement_batches where provider_name=$1 and external_batch_id=$2',
          ['test', input.batchId],
        );
        if (!raced.rows[0] || raced.rows[0].request_fingerprint !== fingerprint) {
          throw new ConflictException('Settlement batch ID was concurrently imported with different contents');
        }
        batchId = raced.rows[0].id;
        await client.query('commit');
        return this.getTestSettlement(batchId);
      }

      const seen = new Set<string>();
      let matched = 0;
      let exceptions = 0;
      for (let index = 0; index < input.lines.length; index++) {
        const line = input.lines[index];
        let matchStatus: 'matched'|'unmatched'|'amount_mismatch'|'currency_mismatch'|'duplicate'|'invalid' = 'matched';
        let paymentIntentId: string | null = null;
        let refundId: string | null = null;
        let payoutId: string | null = null;
        const duplicateKey = line.lineType + ':' + line.providerRef;
        if (seen.has(duplicateKey)) matchStatus = 'duplicate';
        seen.add(duplicateKey);
        if (matchStatus === 'matched' && line.currency !== currency) matchStatus = 'currency_mismatch';
        if (matchStatus === 'matched' && (line.feeAmountMinor > line.grossAmountMinor ||
            line.netAmountMinor !== line.grossAmountMinor - line.feeAmountMinor)) matchStatus = 'invalid';

        let expected: any;
        if (matchStatus === 'matched' && line.lineType === 'charge') {
          const r = await client.query(
            "select id,amount,currency,status from payment_intents where provider_name='test' and provider_ref=$1",
            [line.providerRef],
          );
          expected = r.rows[0];
          if (!expected || expected.status !== 'succeeded') matchStatus = 'unmatched';
          else paymentIntentId = expected.id;
        } else if (matchStatus === 'matched' && line.lineType === 'refund') {
          const r = await client.query(
            "select id,amount,currency,status from payment_refunds where provider_name='test' and provider_ref=$1",
            [line.providerRef],
          );
          expected = r.rows[0];
          if (!expected || expected.status !== 'succeeded') matchStatus = 'unmatched';
          else refundId = expected.id;
        } else if (matchStatus === 'matched' && line.lineType === 'payout') {
          const r = await client.query(
            "select id,amount,currency,status from payout_requests where provider_name='test' and provider_ref=$1",
            [line.providerRef],
          );
          expected = r.rows[0];
          if (!expected || expected.status !== 'succeeded') matchStatus = 'unmatched';
          else payoutId = expected.id;
        }
        if (matchStatus === 'matched' && expected) {
          if (expected.currency !== line.currency) matchStatus = 'currency_mismatch';
          else if (Number(expected.amount) !== line.grossAmountMinor) matchStatus = 'amount_mismatch';
        }
        const lineId = randomUUID();
        await client.query(
          `insert into settlement_lines(id,batch_id,line_number,provider_ref,line_type,gross_amount_minor,fee_amount_minor,net_amount_minor,currency,match_status,payment_intent_id,refund_id,payout_id)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [lineId, batchId, index + 1, line.providerRef, line.lineType, line.grossAmountMinor,
            line.feeAmountMinor, line.netAmountMinor, line.currency, matchStatus, paymentIntentId, refundId, payoutId],
        );
        if (matchStatus === 'matched') matched++;
        else {
          exceptions++;
          await client.query(
            `insert into reconciliation_exceptions(id,batch_id,settlement_line_id,kind,details)
             values($1,$2,$3,$4,$5::jsonb)`,
            [randomUUID(), batchId, lineId, matchStatus,
              JSON.stringify({ providerRef: line.providerRef, lineType: line.lineType, grossAmountMinor: line.grossAmountMinor,
                feeAmountMinor: line.feeAmountMinor, netAmountMinor: line.netAmountMinor, currency: line.currency })],
          );
        }
      }
      const status = exceptions ? 'has_exceptions' : 'reconciled';
      await client.query(
        'update settlement_batches set status=$2,line_count=$3,matched_count=$4,exception_count=$5 where id=$1',
        [batchId, status, input.lines.length, matched, exceptions],
      );
      await client.query(
        `insert into admin_audit_events(id,actor_user_id,action,entity_type,entity_id,details)
         values($1,$2,'settlement.test_batch_imported','settlement_batch',$3,$4::jsonb)`,
        [randomUUID(), userId, batchId, JSON.stringify({ status, lineCount: input.lines.length, matchedCount: matched, exceptionCount: exceptions })],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
    return this.getTestSettlement(batchId);
  }

  async getTestSettlement(batchId: string) {
    const batch = await this.pool.query('select * from settlement_batches where id=$1', [batchId]);
    if (!batch.rows[0]) throw new NotFoundException('Settlement batch not found');
    const [lines, exceptions] = await Promise.all([
      this.pool.query('select * from settlement_lines where batch_id=$1 order by line_number', [batchId]),
      this.pool.query('select * from reconciliation_exceptions where batch_id=$1 order by created_at', [batchId]),
    ]);
    return {
      ...batch.rows[0],
      lineCount: Number(batch.rows[0].line_count),
      matchedCount: Number(batch.rows[0].matched_count),
      exceptionCount: Number(batch.rows[0].exception_count),
      lines: lines.rows,
      exceptions: exceptions.rows,
      testMode: true,
      realMoney: false,
      ledgerPosted: false,
    };
  }
}
