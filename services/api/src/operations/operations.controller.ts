import {
  BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import {
  IsIn, IsOptional, IsString, Length, Matches, IsObject,
} from 'class-validator';
import { AuthGuard, AuthUser, CurrentUser } from '../auth/auth';
import { AdminRoleGuard, RequireAdminRoles } from '../admin/admin-role.guard';
import { OperationsService } from './operations.service';

class CreateSupportCaseDto {
  @IsIn(['general','account','payment','merchant','security','other']) category!: string;
  @IsString() @Length(4, 120) subject!: string;
  @IsString() @Length(10, 3000) description!: string;
}
class CreateRiskCaseDto {
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @IsIn(['fraud','aml','sanctions','account_takeover','transaction_anomaly','merchant_risk','other']) category!: string;
  @IsIn(['low','medium','high','critical']) severity!: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-f-]{36}$/i) userId?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-f-]{36}$/i) merchantId?: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-f-]{36}$/i) paymentIntentId?: string;
  @IsString() @Length(5, 500) summary!: string;
  @IsOptional() @IsObject() details?: Record<string, unknown>;
}
class ResolveRiskCaseDto {
  @IsIn(['resolved','false_positive']) status!: 'resolved'|'false_positive';
  @IsString() @Length(3, 500) note!: string;
}
class UpdateSupportCaseDto {
  @IsIn(['in_progress','waiting_customer','resolved','closed']) status!: 'in_progress'|'waiting_customer'|'resolved'|'closed';
  @IsOptional() @IsString() @Length(3, 500) note?: string;
}
class SubmitMarketGateDto {
  @IsString() @Length(4, 500) evidenceReference!: string;
  @IsString() @Length(3, 1000) note!: string;
}
class MarketGateNoteDto {
  @IsString() @Length(3, 1000) note!: string;
}

@Controller('support/cases')
@UseGuards(AuthGuard)
export class CustomerSupportController {
  constructor(private readonly operations: OperationsService) {}
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateSupportCaseDto) {
    return this.operations.createSupportCase(user.id, body);
  }
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.operations.listMySupportCases(user.id);
  }
}

@Controller('admin/operations')
@UseGuards(AuthGuard, AdminRoleGuard)
@RequireAdminRoles('super_admin','compliance_admin','support_admin','finance_admin')
export class OperationsAdminController {
  constructor(private readonly operations: OperationsService) {}
  @Get('overview')
  overview() { return this.operations.overview(); }
  @Get('markets')
  markets() { return this.operations.listMarkets(); }
  @Get('audit')
  audit() { return this.operations.auditTrail(); }
}

@Controller('admin/risk-cases')
@UseGuards(AuthGuard, AdminRoleGuard)
@RequireAdminRoles('super_admin','compliance_admin')
export class RiskAdminController {
  constructor(private readonly operations: OperationsService) {}
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateRiskCaseDto) {
    return this.operations.createRiskCase(user.id, body);
  }
  @Get()
  list(@Query('status') status?: string) { return this.operations.listRiskCases(status); }
  @Post(':id/decision')
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ResolveRiskCaseDto) {
    return this.operations.resolveRiskCase(user.id, id, body.status, body.note);
  }
}

@Controller('admin/support/cases')
@UseGuards(AuthGuard, AdminRoleGuard)
@RequireAdminRoles('super_admin','support_admin')
export class SupportAdminController {
  constructor(private readonly operations: OperationsService) {}
  @Get()
  list(@Query('status') status?: string) { return this.operations.listSupportCases(status); }
  @Post(':id/status')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UpdateSupportCaseDto) {
    return this.operations.updateSupportCase(user.id, id, body.status, body.note);
  }
}

@Controller('admin/markets')
@UseGuards(AuthGuard, AdminRoleGuard)
@RequireAdminRoles('super_admin','compliance_admin','finance_admin')
export class MarketReadinessAdminController {
  constructor(private readonly operations: OperationsService) {}
  @Post(':countryCode/gates/:gateKey/submit')
  submit(
    @CurrentUser() user: AuthUser, @Param('countryCode') countryCode: string, @Param('gateKey') gateKey: string,
    @Body() body: SubmitMarketGateDto,
  ) {
    return this.operations.submitMarketGate(user.id, countryCode, gateKey, body.evidenceReference, body.note);
  }
  @Post(':countryCode/gates/:gateKey/block')
  block(
    @CurrentUser() user: AuthUser, @Param('countryCode') countryCode: string, @Param('gateKey') gateKey: string,
    @Body() body: MarketGateNoteDto,
  ) {
    return this.operations.blockMarketGate(user.id, countryCode, gateKey, body.note);
  }
  @Post(':countryCode/gates/:gateKey/approve')
  approve(
    @CurrentUser() user: AuthUser, @Param('countryCode') countryCode: string, @Param('gateKey') gateKey: string,
    @Body() body: MarketGateNoteDto,
  ) {
    return this.operations.approveMarketGate(user.id, countryCode, gateKey, body.note);
  }
}
