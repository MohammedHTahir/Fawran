import { createHash } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentIntentStore } from './payment-intent.store';
import { PaymentIntentStatus } from './payment-lifecycle';

export interface TestProviderEvent {
  eventId: string;
  eventType: 'payment.pending' | 'payment.succeeded' | 'payment.failed' | 'payment.reversed';
  paymentIntentId: string;
  providerRef: string;
}

const EVENT_STATUS = {
  'payment.pending': 'pending',
  'payment.succeeded': 'succeeded',
  'payment.failed': 'failed',
  'payment.reversed': 'reversed',
} as const;

@Injectable()
export class TestPaymentService {
  constructor(private readonly intents: PaymentIntentStore) {}

  async createIntent(input: {
    userId: string; idempotencyKey: string; amount: number; currency: string; method: string;
  }) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Test payment orchestration is disabled in production');
    }
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      userId: input.userId, amount: input.amount, currency: input.currency, method: input.method,
    })).digest('hex');
    const reference = 'test_' + createHash('sha256')
      .update(input.userId + ':' + input.idempotencyKey).digest('hex').slice(0, 32);
    const intent = await this.intents.create({
      idempotencyKey: input.userId + ':test-payment:' + input.idempotencyKey,
      reference, userId: input.userId, amount: input.amount, currency: input.currency,
      method: input.method, requestFingerprint,
    });
    const providerRef = 'test_' + createHash('sha256').update(reference).digest('hex').slice(0, 32);
    await this.intents.bindProvider(intent.id, 'test', providerRef);
    return {
      intentId: intent.id, reference, provider: 'test', providerRef,
      amount: input.amount, currency: input.currency, status: intent.status,
      testMode: true, realMoney: false, ledgerPosted: false,
    };
  }

  async processEvent(event: TestProviderEvent, rawBody: Buffer) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('Test provider webhooks are disabled in production');
    }
    const intent = await this.intents.get(event.paymentIntentId);
    if (intent.provider_name !== 'test' || intent.provider_ref !== event.providerRef) {
      throw new BadRequestException('Test provider reference does not match the payment intent');
    }
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const recorded = await this.intents.recordProviderEvent({
      providerName: 'test', providerEventId: event.eventId, eventType: event.eventType,
      payloadSha256: digest, paymentIntentId: event.paymentIntentId,
    });
    let next: PaymentIntentStatus = EVENT_STATUS[event.eventType];
    // A contradictory late success is never silently accepted after a failure.
    if (intent.status === 'failed' && next === 'succeeded') next = 'under_review';
    try {
      const transition = await this.intents.transition(event.paymentIntentId, next);
      await this.intents.markProviderEventProcessed(recorded.eventId);
      return {
        eventId: event.eventId, duplicate: !recorded.inserted, status: transition.status,
        testMode: true, realMoney: false, ledgerPosted: false,
      };
    } catch (error) {
      await this.intents.markProviderEventFailed(recorded.eventId, 'transition_rejected');
      throw error;
    }
  }
}
