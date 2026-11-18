import {
  BadRequestException, Body, Controller, Headers, Post, RawBodyRequest, Req,
  UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth';
import { getMarketByCurrency } from '../markets/market-registry';
import { TestPaymentService, TestProviderEvent } from './test-payment.service';

class CreateTestIntentDto {
  @IsInt() @Min(1) @Max(5_000_000) amount!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsIn(['card', 'wallet', 'instapay']) method!: string;
}

class TestProviderEventDto {
  @IsString() @Matches(/^[A-Za-z0-9._:-]{8,160}$/) eventId!: string;
  @IsIn(['payment.pending', 'payment.succeeded', 'payment.failed', 'payment.reversed']) eventType!: TestProviderEvent['eventType'];
  @IsString() @Matches(/^[0-9a-f-]{36}$/i) paymentIntentId!: string;
  @IsString() @Matches(/^test_[a-f0-9]{32}$/) providerRef!: string;
}

export function signTestProviderWebhook(rawBody: Buffer, secret: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(String(timestamp) + '.').update(rawBody).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

export function verifyTestProviderWebhook(
  rawBody: Buffer, signature: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!signature || !secret || secret.length < 32) return false;
  const parts = Object.fromEntries(signature.split(',').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const timestamp = Number(parts.t);
  const supplied = parts.v1;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300 || !/^[a-f0-9]{64}$/i.test(supplied ?? '')) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(String(timestamp) + '.').update(rawBody).digest();
  const actual = Buffer.from(supplied, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

@Controller('payments/test')
@UseGuards(AuthGuard)
export class TestPaymentIntentController {
  constructor(private readonly payments: TestPaymentService) {}

  @Post('intents')
  async create(
    @CurrentUser() user: AuthUser, @Body() body: CreateTestIntentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    if (process.env.NODE_ENV === 'production') throw new BadRequestException('Test payments are disabled in production');
    if (!key || key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key header required');
    const currency = body.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported test payment currency');
    return this.payments.createIntent({ userId: user.id, idempotencyKey: key, amount: body.amount, currency, method: body.method });
  }
}

@Controller('webhooks/test-provider')
export class TestProviderWebhookController {
  constructor(private readonly payments: TestPaymentService) {}

  @Post()
  async receive(
    @Req() request: RawBodyRequest<any>,
    @Body() body: TestProviderEventDto,
    @Headers('x-test-provider-signature') signature?: string,
  ) {
    if (process.env.NODE_ENV === 'production') throw new BadRequestException('Test provider webhooks are disabled in production');
    const secret = process.env.TEST_PROVIDER_WEBHOOK_SECRET ?? '';
    const rawBody = request.rawBody;
    if (!rawBody || !verifyTestProviderWebhook(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid or expired test provider webhook signature');
    }
    return this.payments.processEvent(body, rawBody);
  }
}
