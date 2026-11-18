import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth';
import { FinanceAdminGuard } from '../admin/finance-admin.guard';
import { FxQuoteService } from './fx-quote.service';

class UpsertTestFxRateDto {
  @IsString() @Matches(/^[A-Z]{3}$/) fromCurrency!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) toCurrency!: string;
  @IsInt() @Min(1) @Max(1_000_000_000_000) rateNumerator!: number;
  @IsInt() @Min(1) @Max(1_000_000_000_000) rateDenominator!: number;
  @IsInt() @Min(0) @Max(10000) feeBps!: number;
  @IsString() @Length(3, 100) sourceLabel!: string;
}
class CreateTestFxQuoteDto {
  @IsString() @Matches(/^[A-Z]{3}$/) fromCurrency!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) toCurrency!: string;
  @IsInt() @Min(1) @Max(1_000_000_000_000) amountMinor!: number;
}

@Controller('fx/test/quotes')
@UseGuards(AuthGuard)
export class TestFxQuoteController {
  constructor(private readonly fx: FxQuoteService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateTestFxQuoteDto, @Headers('idempotency-key') key?: string) {
    if (!key || key.length < 8 || key.length > 200) throw new BadRequestException('Idempotency-Key header required');
    return this.fx.createQuote(user.id, { ...body, idempotencyKey: key });
  }

  @Get(':quoteId')
  get(@CurrentUser() user: AuthUser, @Param('quoteId') quoteId: string) {
    return this.fx.getQuote(user.id, quoteId);
  }
}

@Controller('admin/fx/test-rates')
@UseGuards(AuthGuard, FinanceAdminGuard)
export class TestFxRateAdminController {
  constructor(private readonly fx: FxQuoteService) {}

  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() body: UpsertTestFxRateDto) {
    return this.fx.upsertTestRate(user.id, body);
  }
}
