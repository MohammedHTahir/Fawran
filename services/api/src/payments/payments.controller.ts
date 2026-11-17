import { createHmac, createHash, timingSafeEqual } from 'crypto';
import {
  Body, ConflictException, Controller, ForbiddenException, Get, Headers, HttpCode,
  Param, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { IsString as IsStringValidator, IsIn as IsInValidator, IsInt as IsIntValidator, IsOptional as IsOptionalValidator, Length as LengthValidator, Max as MaxValidator, Min as MinValidator } from 'class-validator';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { PaymentOrchestrationService } from './payment-orchestration.service';
import { PayMethod } from '../provider/provider';

class CreatePaymentIntentDto {
  @IsIntValidator() @MinValidator(1) @MaxValidator(50_000_000) amount!: number;
  @IsStringValidator() @LengthValidator(3, 3) currency!: string;
  @IsInValidator(['instapay','card','wallet']) method!: PayMethod;
}
class ProviderWebhookDto {
  @IsStringValidator() @LengthValidator(4, 128) id!: string;
  @IsStringValidator() @LengthValidator(4, 80) type!: string;
  @IsStringValidator() @LengthValidator(8, 128) intentId!: string;
  @IsStringValidator() @LengthValidator(1, 256) providerRef!: string;
}
class RefundDto {
  @IsIntValidator() @MinValidator(1) @MaxValidator(50_000_000) amount!: number;
  @IsOptionalValidator() @IsStringValidator() @LengthValidator(0, 500) reason?: string;
}
class PayoutDto {
  @IsIntValidator() @MinValidator(1) @MaxValidator(100_000_000) amount!: number;
  @IsStringValidator() @LengthValidator(3, 3) currency!: string;
}

@Controller('payments')
@UseGuards(AuthGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentOrchestrationService) {}

  @Post('intents')
  createIntent(@CurrentUser() user: AuthUser, @Body() body: CreatePaymentIntentDto, @Headers('idempotency-key') key?: string) {
    return this.payments.createWalletTopup(user, body, key);
  }

  @Get('intents/:id')
  getIntent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.getForUser(user.id, id);
  }
}

@Controller('webhooks')
export class TestProviderWebhookController {
  constructor(private readonly payments: PaymentOrchestrationService) {}

  @Post('providers/test')
  @HttpCode(200)
  async receive(@Body() body: ProviderWebhookDto, @Headers('x-provider-signature') signature?: string) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException('Test provider webhooks are disabled in production');
    const secret = process.env.TEST_PROVIDER_WEBHOOK_SECRET;
    if (!secret) throw new ServiceUnavailableException('Test provider webhook secret is not configured');
    if (!signature?.startsWith('sha256=')) throw new ConflictException('Missing provider webhook signature');
    const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
    const supplied = signature.slice(7);
    if (supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new ConflictException('Invalid provider webhook signature');
    }
    const payloadSha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    return this.payments.applyTestWebhook({
      eventId: body.id, eventType: body.type, intentId: body.intentId,
      providerRef: body.providerRef, payloadSha256,
    });
  }
}

@Controller('admin/payments')
@UseGuards(AuthGuard, FinanceAdminGuard)
export class RefundAdminController {
  constructor(private readonly payments: PaymentOrchestrationService) {}

  @Post(':id/refunds')
  refund(@Param('id') id: string, @Body() body: RefundDto, @Headers('idempotency-key') key?: string) {
    if (!key) throw new ConflictException('Idempotency-Key header required');
    return this.payments.refund(id, body.amount, key, body.reason);
  }
}

@Controller('merchants')
@UseGuards(AuthGuard)
export class MerchantPayoutController {
  constructor(private readonly payments: PaymentOrchestrationService) {}

  @Post(':id/payouts')
  request(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: PayoutDto, @Headers('idempotency-key') key?: string) {
    if (!key) throw new ConflictException('Idempotency-Key header required');
    return this.payments.requestPayout(user.id, id, body.amount, body.currency, key);
  }

  @Get(':id/payouts')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.listPayouts(user.id, id);
  }
}
