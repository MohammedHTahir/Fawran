import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { AuthUser } from '../auth/auth';
import { PG_POOL, SYSTEM_PROVIDER_ACCOUNT } from '../db/db.module';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.port';
import { getMarketByCurrency } from '../markets/market-registry';
import { PAYMENT_PROVIDER, PaymentProvider, PayMethod } from '../provider/provider';
import { PaymentIntentStore } from './payment-intent.store';

@Injectable()
export class PaymentOrchestrationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly intents: PaymentIntentStore,
  ) {}

  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private requireKey(key?: string) {
    if (!key || key.length < 8 || key.length > 512) {
      throw new BadRequestException('Idempotency-Key header required (8-512 characters)');
    }
    return key;
  }

  private async providerAccount(currency: string): Promise<string> {
    const existing = await this.pool.query(
      'select ledger_account_id from system_provider_accounts where currency=$1', [currency],
    );
    if (existing.rows[0]) return String(existing.rows[0].ledger_account_id);
    const accountId = currency === 'EGP'
      ? SYSTEM_PROVIDER_ACCOUNT
      : await this.ledger.createAccount(null, 'system', currency);
    try {
      await this.pool.query(
        'insert into system_provider_accounts(currency,ledger_account_id) values($1,$2)',
        [currency, accountId],
      );
      return accountId;
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      const raced = await this.pool.query(
        'select ledger_account_id from system_provider_accounts where currency=$1', [currency],
      );
      if (!raced.rows[0]) throw error;
      return String(raced.rows[0].ledger_account_id);
    }
  }

  async createWalletTopup(user: AuthUser, input: { amount: number; currency: string; method: PayMethod }, rawKey?: string) {
    const idempotencyKey = this.requireKey(rawKey);
    const currency = input.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported payment currency');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 50_000_000) {
      throw new BadRequestException('Amount must be a positive integer in currency minor units');
    }
    const wallet = await this.pool.query(
      'select id from accounts where owner_id=$1 and currency=$2', [user.id, currency],
    );
    if (!wallet.rows[0]) throw new NotFoundException(`No ${currency} wallet exists; create the wallet first`);
    const destinationAccountId = String(wallet.rows[0].id);
    const requestFingerprint = this.fingerprint({
      userId: user.id, amount: input.amount, currency, method: input.method, destinationAccountId,
    });
    let intent = await this.intents.create({
      idempotencyKey: `wallet-topup:${user.id}:${idempotencyKey}`,
      reference: `wallet-topup:${user.id}:${idempotencyKey}`,
      userId: user.id, amount: input.amount, currency, method: input.method,
      requestFingerprint, destinationAccountId, purpose: 'wallet_topup',
    });
    if (intent.status === 'succeeded' && intent.ledger_txn_id) {
      return { intentId: intent.id, status: 'succeeded', txnId: intent.ledger_txn_id, replayed: true };
    }
    if (intent.status === 'failed' || intent.status === 'reversed') {
      throw new ConflictException(`Payment intent is ${intent.status}; create a new intent`);
    }
    if (intent.status === 'created') {
      await this.intents.transition(String(intent.id), 'pending');
      intent = (await this.intents.get(String(intent.id)))!;
    }

    let providerRef = intent.provider_ref ? String(intent.provider_ref) : null;
    if (!providerRef) {
      const charge = await this.provider.charge({
        amount: input.amount, currency, method: input.method, reference: `payment-intent:${intent.id}`,
      });
      providerRef = charge.providerRef;
      await this.intents.setProviderResult(String(intent.id), this.provider.name ?? 'test', providerRef);
      if (!charge.ok) {
        await this.intents.transition(String(intent.id), 'failed');
        return { intentId: intent.id, status: 'failed', providerRef, replayed: false };
      }
      intent = (await this.intents.get(String(intent.id)))!;
    }

    try {
      const from = await this.providerAccount(currency);
      const transfer = await this.ledger.transfer({
        from, to: destinationAccountId, amount: input.amount, currency,
        idemKey: `payment-intent-settlement:${intent.id}`,
        kind: 'payment_intent_settlement', memo: providerRef,
      });
      await this.intents.setLedgerTransaction(String(intent.id), transfer.txnId);
      const latest = await this.intents.get(String(intent.id));
      if (latest?.status === 'pending' || latest?.status === 'under_review') {
        await this.intents.transition(String(intent.id), 'succeeded');
      }
      return { intentId: intent.id, status: 'succeeded', txnId: transfer.txnId, providerRef, replayed: transfer.replayed };
    } catch (error) {
      const latest = await this.intents.get(String(intent.id));
      if (latest?.status === 'pending') await this.intents.transition(String(intent.id), 'under_review');
      return { intentId: intent.id, status: 'under_review', providerRef, needsReconciliation: true };
    }
  }

  async getForUser(userId: string, intentId: string) {
    const intent = await this.intents.get(intentId);
    if (!intent || intent.user_id !== userId) throw new NotFoundException('Payment intent not found');
    return intent;
  }

  async applyTestWebhook(input: {
    eventId: string; eventType: string; intentId: string; providerRef: string; payloadSha256: string;
  }) {
    const recorded = await this.intents.recordProviderEvent({
      providerName: 'mock', providerEventId: input.eventId, eventType: input.eventType,
      payloadSha256: input.payloadSha256, paymentIntentId: input.intentId,
    });
    if (!recorded.inserted) return { accepted: true, replayed: true, eventId: recorded.eventId };
    let intent = await this.intents.get(input.intentId);
    if (!intent) throw new NotFoundException('Payment intent not found');
    await this.intents.setProviderResult(input.intentId, 'mock', input.providerRef);
    if (input.eventType === 'payment.failed') {
      if (intent.status === 'created') await this.intents.transition(input.intentId, 'pending');
      intent = (await this.intents.get(input.intentId))!;
      if (intent.status === 'pending') await this.intents.transition(input.intentId, 'failed');
      else if (intent.status === 'succeeded') await this.intents.transition(input.intentId, 'under_review');
      return { accepted: true, replayed: false, status: (await this.intents.get(input.intentId))?.status };
    }
    if (input.eventType !== 'payment.succeeded') {
      return { accepted: true, replayed: false, ignored: true };
    }
    if (intent.status === 'created') await this.intents.transition(input.intentId, 'pending');
    intent = (await this.intents.get(input.intentId))!;
    if (intent.status === 'failed') {
      await this.intents.transition(input.intentId, 'under_review');
      intent = (await this.intents.get(input.intentId))!;
    }
    if (intent.status === 'succeeded' && intent.ledger_txn_id) {
      return { accepted: true, replayed: false, status: 'succeeded', txnId: intent.ledger_txn_id };
    }
    if (!intent.destination_account_id) throw new ConflictException('Payment intent has no settlement destination');
    try {
      const from = await this.providerAccount(String(intent.currency));
      const transfer = await this.ledger.transfer({
        from, to: String(intent.destination_account_id), amount: Number(intent.amount),
        currency: String(intent.currency), idemKey: `payment-intent-settlement:${intent.id}`,
        kind: 'payment_intent_settlement', memo: input.providerRef,
      });
      await this.intents.setLedgerTransaction(input.intentId, transfer.txnId);
      const latest = await this.intents.get(input.intentId);
      if (latest?.status === 'pending' || latest?.status === 'under_review') {
        await this.intents.transition(input.intentId, 'succeeded');
      }
      return { accepted: true, replayed: false, status: 'succeeded', txnId: transfer.txnId };
    } catch {
      const latest = await this.intents.get(input.intentId);
      if (latest?.status === 'pending') await this.intents.transition(input.intentId, 'under_review');
      return { accepted: true, replayed: false, status: 'under_review', needsReconciliation: true };
    }
  }

  async refund(paymentIntentId: string, amount: number, rawKey: string, reason?: string) {
    const idempotencyKey = this.requireKey(rawKey);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Refund amount must be a positive integer');
    const intent = await this.intents.get(paymentIntentId);
    if (!intent || intent.status !== 'succeeded' || !intent.provider_ref || !intent.destination_account_id) {
      throw new ConflictException('Only settled payment intents can be refunded');
    }
    const fingerprint = this.fingerprint({ paymentIntentId, amount, reason: reason ?? null });
    const prior = await this.pool.query(
      'select id,request_fingerprint,status,ledger_txn_id from refunds where idempotency_key=$1',
      [idempotencyKey],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].request_fingerprint !== fingerprint) throw new ConflictException('Refund idempotency key reused with different details');
      return { refundId: prior.rows[0].id, status: prior.rows[0].status, txnId: prior.rows[0].ledger_txn_id, replayed: true };
    }
    const client = await this.pool.connect();
    const refundId = randomUUID();
    try {
      await client.query('begin');
      const locked = await client.query('select id,amount,currency,status from payment_intents where id=$1 for update', [paymentIntentId]);
      if (!locked.rows[0] || locked.rows[0].status !== 'succeeded') throw new ConflictException('Payment intent is no longer refundable');
      const totals = await client.query(
        "select coalesce(sum(amount),0)::bigint as total from refunds where payment_intent_id=$1 and status in ('processing','succeeded','needs_reconciliation')",
        [paymentIntentId],
      );
      if (Number(totals.rows[0].total) + amount > Number(locked.rows[0].amount)) {
        throw new BadRequestException('Refund amount exceeds the remaining captured amount');
      }
      await client.query(
        `insert into refunds(id,idempotency_key,request_fingerprint,payment_intent_id,amount,currency,reason)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [refundId, idempotencyKey, fingerprint, paymentIntentId, amount, locked.rows[0].currency, reason ?? null],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const currency = String(intent.currency);
    const providerRefund = await this.provider.refund({
      amount, currency, providerRef: String(intent.provider_ref), reference: `refund:${refundId}`,
    });
    if (!providerRefund.ok) {
      await this.pool.query("update refunds set status='failed',provider_ref=$2,updated_at=now() where id=$1",
        [refundId, providerRefund.providerRef]);
      return { refundId, status: 'failed' };
    }
    await this.pool.query('update refunds set provider_ref=$2,updated_at=now() where id=$1',
      [refundId, providerRefund.providerRef]);
    try {
      const to = await this.providerAccount(currency);
      const transfer = await this.ledger.transfer({
        from: String(intent.destination_account_id), to, amount, currency,
        idemKey: `refund-ledger:${refundId}`, kind: 'payment_refund', memo: providerRefund.providerRef,
      });
      await this.pool.query("update refunds set status='succeeded',ledger_txn_id=$2,updated_at=now() where id=$1",
        [refundId, transfer.txnId]);
      const total = await this.pool.query(
        "select coalesce(sum(amount),0)::bigint as total from refunds where payment_intent_id=$1 and status='succeeded'",
        [paymentIntentId],
      );
      if (Number(total.rows[0].total) >= Number(intent.amount)) {
        await this.intents.transition(paymentIntentId, 'reversed');
      }
      return { refundId, status: 'succeeded', txnId: transfer.txnId, replayed: transfer.replayed };
    } catch {
      await this.pool.query("update refunds set status='needs_reconciliation',updated_at=now() where id=$1", [refundId]);
      return { refundId, status: 'needs_reconciliation' };
    }
  }

  async listPayouts(userId: string, merchantId: string) {
    const membership = await this.pool.query(
      'select role from merchant_members where merchant_id=$1 and user_id=$2',
      [merchantId, userId],
    );
    if (!membership.rows[0]) throw new NotFoundException('Merchant not found');
    const result = await this.pool.query(
      'select id,amount,currency,status,blocked_reason,created_at,updated_at from payout_requests where merchant_id=$1 order by created_at desc',
      [merchantId],
    );
    return result.rows.map((row: any) => ({ ...row, amount: Number(row.amount) }));
  }

  async requestPayout(userId: string, merchantId: string, amount: number, currency: string, rawKey: string) {
    const idempotencyKey = this.requireKey(rawKey);
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!getMarketByCurrency(normalizedCurrency)) throw new BadRequestException('Unsupported payout currency');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new BadRequestException('Payout amount must be positive integer minor units');
    const merchant = await this.pool.query(
      `select m.id,m.kyb_status,m.status,ma.id as merchant_account_id,ma.settlement_status
       from merchants m join merchant_members mm on mm.merchant_id=m.id
       join merchant_accounts ma on ma.merchant_id=m.id and ma.currency=$3
       where m.id=$1 and mm.user_id=$2 and mm.role in ('owner','admin')`,
      [merchantId, userId, normalizedCurrency],
    );
    if (!merchant.rows[0]) throw new NotFoundException('Merchant account not found');
    if (merchant.rows[0].kyb_status !== 'approved' || merchant.rows[0].status !== 'active') {
      throw new ForbiddenException('Merchant KYB approval is required before payout requests');
    }
    const fingerprint = this.fingerprint({ merchantId, amount, currency: normalizedCurrency });
    const existing = await this.pool.query(
      'select id,request_fingerprint,status,blocked_reason from payout_requests where idempotency_key=$1',
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint && existing.rows[0].request_fingerprint !== fingerprint) {
        throw new ConflictException('Payout idempotency key reused with different details');
      }
      return { payoutId: existing.rows[0].id, status: existing.rows[0].status, blockedReason: existing.rows[0].blocked_reason, replayed: true };
    }
    const payoutId = randomUUID();
    await this.pool.query(
      `insert into payout_requests(id,idempotency_key,request_fingerprint,merchant_id,merchant_account_id,amount,currency,status,blocked_reason)
       values($1,$2,$3,$4,$5,$6,$7,'blocked','licensed_partner_and_market_approval_required')`,
      [payoutId, idempotencyKey, fingerprint, merchantId, merchant.rows[0].merchant_account_id, amount, normalizedCurrency],
    );
    return { payoutId, status: 'blocked', blockedReason: 'licensed_partner_and_market_approval_required', replayed: false };
  }
}
