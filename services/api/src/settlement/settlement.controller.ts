import {
  BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsString, Length, Matches, Max, Min, ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { SettlementService, TestSettlementLine } from './settlement.service';

class CreateTestRefundDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i) paymentIntentId!: string;
  @IsInt() @Min(1) @Max(5_000_000) amountMinor!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsString() @Length(3, 250) reason!: string;
}
class CreateTestPayoutDto {
  @IsInt() @Min(1) @Max(100_000_000) amountMinor!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}
class TestSettlementLineDto implements TestSettlementLine {
  @IsString() @Length(8, 160) providerRef!: string;
  @IsIn(['charge','refund','payout']) lineType!: 'charge'|'refund'|'payout';
  @IsInt() @Min(1) @Max(100_000_000_000) grossAmountMinor!: number;
  @IsInt() @Min(0) @Max(100_000_000_000) feeAmountMinor!: number;
  @IsInt() @Min(0) @Max(100_000_000_000) netAmountMinor!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}
class ImportTestSettlementDto {
  @IsString() @Length(4, 120) batchId!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) settlementDate!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TestSettlementLineDto) lines!: TestSettlementLineDto[];
}

@Controller('payments/test')
@UseGuards(AuthGuard)
export class TestRefundController {
  constructor(private readonly settlement: SettlementService) {}

  @Post('refunds')
  async create(
    @CurrentUser() user: AuthUser, @Body() body: CreateTestRefundDto,
    @Headers('idempotency-key') key?: string,
  ) {
    if (!key || key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key header required');
    return this.settlement.createTestRefund(user.id, { ...body, idempotencyKey: key });
  }
}

@Controller('merchants/:merchantId/test-payouts')
@UseGuards(AuthGuard)
export class TestPayoutController {
  constructor(private readonly settlement: SettlementService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser, @Param('merchantId') merchantId: string,
    @Body() body: CreateTestPayoutDto, @Headers('idempotency-key') key?: string,
  ) {
    if (!key || key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key header required');
    return this.settlement.createBlockedTestPayout(user.id, merchantId, { ...body, idempotencyKey: key });
  }
}

@Controller('admin/test-settlements')
@UseGuards(AuthGuard, FinanceAdminGuard)
export class TestSettlementAdminController {
  constructor(private readonly settlement: SettlementService) {}

  @Post('import')
  async import(@CurrentUser() user: AuthUser, @Body() body: ImportTestSettlementDto) {
    return this.settlement.importTestSettlement(user.id, body);
  }

  @Get(':batchId')
  async get(@Param('batchId') batchId: string) {
    return this.settlement.getTestSettlement(batchId);
  }
}
