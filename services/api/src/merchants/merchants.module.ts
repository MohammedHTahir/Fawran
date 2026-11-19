import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min,
} from 'class-validator';
import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject,
  Injectable, Module, NotFoundException, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AuthGuard, AuthModule, AuthUser, CurrentUser } from '../auth/auth';
import { PG_POOL } from '../db/db.module';
import { LEDGER_PORT, LedgerPort } from '../ledger/ledger.port';
import { getMarketByCurrency, getMarketProfile } from '../markets/market-registry';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminGuard } from '../admin/admin.guard';

class CreateMerchantDto {
  @IsString() @Length(2, 120) legalName!: string;
  @IsString() @Length(2, 80) displayName!: string;
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}
class CreateMerchantAccountDto {
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}
class SubmitKybDto {
  @IsString() @Length(2, 100) registrationNumber!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8)
  @IsIn(['trade_license','beneficial_owner_id','proof_of_address','bank_statement','tax_certificate'], { each: true })
  documentTypes!: string[];
}
class CreateMerchantLinkDto {
  @IsInt() @Min(1) @Max(50_000_000) amount!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @IsString() @Length(0, 140) description?: string;
}
class CreateOfferDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
}
class CreateCampaignDto {
  @IsString() @Length(2, 100) name!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsInt() @Min(1) @Max(100_000_000_000) budgetMinor!: number;
  @IsInt() @Min(1) @Max(100_000) pointsPerMinor!: number;
  @IsOptional() @IsInt() @Min(1) maxPointsPerUser?: number;
}
class CreateMerchantStoreDto {
  @IsString() @Length(2, 100) name!: string;
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @IsOptional() @IsString() @Length(0, 300) address?: string;
}
class UpdateMerchantStoreDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @Length(0, 300) address?: string;
  @IsOptional() @IsString() @IsIn(['active','suspended']) status?: 'active'|'suspended';
}
class CreateMerchantInvitationDto {
  @IsString() @Matches(/^\+[1-9]\d{7,14}$/) phone!: string;
  @IsString() @IsIn(['admin','manager','viewer']) role!: 'admin'|'manager'|'viewer';
}
class UpdateMerchantMemberRoleDto {
  @IsString() @IsIn(['admin','manager','viewer']) role!: 'admin'|'manager'|'viewer';
}
class KybDecisionDto {
  @IsString() @IsIn(['approved','rejected','needs_info']) decision!: 'approved'|'rejected'|'needs_info';
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

@Injectable()
export class MerchantService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(LEDGER_PORT) private readonly ledger: LedgerPort,
  ) {}

  private async membership(userId: string, merchantId: string, roles?: string[]) {
    const result = await this.pool.query(
      'select m.*, mm.role from merchants m join merchant_members mm on mm.merchant_id=m.id where m.id=$1 and mm.user_id=$2',
      [merchantId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException('Merchant not found');
    if (roles && !roles.includes(result.rows[0].role)) throw new ForbiddenException('Insufficient merchant permissions');
    return result.rows[0];
  }

  async create(user: AuthUser, body: CreateMerchantDto) {
    const countryCode = body.countryCode.trim().toUpperCase();
    const currency = body.currency.trim().toUpperCase();
    const market = getMarketProfile(countryCode);
    if (!market || market.currency !== currency) {
      throw new BadRequestException('Merchant country and settlement currency must match a market in the catalog');
    }
    const merchantId = randomUUID();
    const ledgerAccountId = await this.ledger.createAccount(null, 'merchant', currency);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into merchants(id,owner_user_id,legal_name,display_name,country_code,currency)
         values($1,$2,$3,$4,$5,$6)`,
        [merchantId, user.id, body.legalName.trim(), body.displayName.trim(), countryCode, currency],
      );
      await client.query(
        "insert into merchant_members(merchant_id,user_id,role) values($1,$2,'owner')",
        [merchantId, user.id],
      );
      await client.query(
        "insert into merchant_accounts(id,merchant_id,currency,ledger_account_id,settlement_status) values($1,$2,$3,$4,'blocked')",
        [randomUUID(), merchantId, currency, ledgerAccountId],
      );
      await client.query('commit');
      return {
        merchantId, legalName: body.legalName.trim(), displayName: body.displayName.trim(),
        countryCode, currency, status: 'pending', kybStatus: 'not_started',
        settlementStatus: 'blocked', paymentsEnabled: false,
      };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listMine(userId: string) {
    const result = await this.pool.query(
      `select m.id,m.display_name,m.country_code,m.currency,m.kyb_status,m.status,mm.role
       from merchants m join merchant_members mm on mm.merchant_id=m.id
       where mm.user_id=$1 order by m.created_at desc`,
      [userId],
    );
    return result.rows;
  }

  async get(userId: string, merchantId: string) {
    const merchant = await this.membership(userId, merchantId);
    const accounts = await this.pool.query(
      'select id,currency,ledger_account_id,settlement_status from merchant_accounts where merchant_id=$1 order by currency',
      [merchantId],
    );
    const wallets = await Promise.all(accounts.rows.map(async (row: any) => ({
      currency: row.currency, balance: await this.ledger.balance(row.ledger_account_id),
      unit: 'minor', settlementStatus: row.settlement_status,
    })));
    return {
      merchantId: merchant.id, legalName: merchant.legal_name, displayName: merchant.display_name,
      countryCode: merchant.country_code, currency: merchant.currency,
      kybStatus: merchant.kyb_status, status: merchant.status, role: merchant.role,
      paymentsEnabled: false, accounts: wallets,
    };
  }

  async createAccount(userId: string, merchantId: string, body: CreateMerchantAccountDto) {
    const merchant = await this.membership(userId, merchantId, ['owner','admin']);
    const currency = body.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported merchant account currency');
    const existing = await this.pool.query(
      'select id,currency,ledger_account_id,settlement_status from merchant_accounts where merchant_id=$1 and currency=$2',
      [merchantId, currency],
    );
    if (existing.rows[0]) return { currency, created: false, settlementStatus: existing.rows[0].settlement_status };
    const ledgerAccountId = await this.ledger.createAccount(null, 'merchant', currency);
    try {
      await this.pool.query(
        "insert into merchant_accounts(id,merchant_id,currency,ledger_account_id,settlement_status) values($1,$2,$3,$4,'blocked')",
        [randomUUID(), merchantId, currency, ledgerAccountId],
      );
      return { currency, created: true, settlementStatus: 'blocked' };
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      return { currency, created: false, settlementStatus: 'blocked' };
    }
  }

  async createStore(userId: string, merchantId: string, body: CreateMerchantStoreDto) {
    const merchant = await this.membership(userId, merchantId, ['owner','admin','manager']);
    const countryCode = body.countryCode.trim().toUpperCase();
    if (!getMarketProfile(countryCode)) throw new BadRequestException('Unsupported store market');
    const id = randomUUID();
    await this.pool.query(
      `insert into merchant_stores(id,merchant_id,name,country_code,address,status)
       values($1,$2,$3,$4,$5,'draft')`,
      [id, merchantId, body.name.trim(), countryCode, body.address?.trim() || null],
    );
    return { storeId: id, merchantId, name: body.name.trim(), countryCode, address: body.address?.trim() || null, status: 'draft' };
  }

  async listStores(userId: string, merchantId: string) {
    await this.membership(userId, merchantId);
    const result = await this.pool.query(
      `select id as "storeId",name,country_code as "countryCode",address,status,created_at as "createdAt"
       from merchant_stores where merchant_id=$1 order by created_at desc`,
      [merchantId],
    );
    return result.rows;
  }

  async updateStore(userId: string, merchantId: string, storeId: string, body: UpdateMerchantStoreDto) {
    const merchant = await this.membership(userId, merchantId, ['owner','admin','manager']);
    if (body.status && !['owner','admin'].includes(merchant.role)) {
      throw new ForbiddenException('Only merchant owners and admins can change store status');
    }
    if (body.name === undefined && body.address === undefined && body.status === undefined) {
      throw new BadRequestException('Provide at least one store field to update');
    }
    const result = await this.pool.query(
      `update merchant_stores set
         name=coalesce($3,name),
         address=case when $4::boolean then $5 else address end,
         status=coalesce($6,status)
       where id=$1 and merchant_id=$2
       returning id as "storeId",name,country_code as "countryCode",address,status,created_at as "createdAt"`,
      [storeId, merchantId, body.name?.trim() ?? null, body.address !== undefined, body.address?.trim() || null, body.status ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Merchant store not found');
    return result.rows[0];
  }

  async createInvitation(actorUserId: string, merchantId: string, body: CreateMerchantInvitationDto) {
    const actor = await this.membership(actorUserId, merchantId, ['owner','admin']);
    if (actor.role !== 'owner' && body.role === 'admin') {
      throw new ForbiddenException('Only the merchant owner can invite an admin');
    }
    const invitee = await this.pool.query('select id from users where phone=$1', [body.phone]);
    if (!invitee.rows[0]) throw new NotFoundException('The invited user must have a registered Fawran account');
    const inviteeId = invitee.rows[0].id;
    if (inviteeId === actorUserId) throw new BadRequestException('You cannot invite yourself');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from merchants where id=$1 for update', [merchantId]);
      const currentActor = await client.query(
        'select role from merchant_members where merchant_id=$1 and user_id=$2 for update',
        [merchantId, actorUserId],
      );
      if (!currentActor.rows[0] || !['owner','admin'].includes(currentActor.rows[0].role)) {
        throw new ForbiddenException('Insufficient merchant permissions');
      }
      if (currentActor.rows[0].role !== 'owner' && body.role === 'admin') {
        throw new ForbiddenException('Only the merchant owner can invite an admin');
      }
      const existingMember = await client.query(
        'select 1 from merchant_members where merchant_id=$1 and user_id=$2',
        [merchantId, inviteeId],
      );
      if (existingMember.rows[0]) throw new ConflictException('This user is already a merchant member');
      await client.query(
        "update merchant_invitations set status='expired',updated_at=now() where merchant_id=$1 and invited_user_id=$2 and status='pending' and expires_at<=now()",
        [merchantId, inviteeId],
      );
      const id = randomUUID();
      await client.query(
        `insert into merchant_invitations(id,merchant_id,invited_user_id,invited_by,role,status,expires_at)
         values($1,$2,$3,$4,$5,'pending',now()+interval '7 days')`,
        [id, merchantId, inviteeId, actorUserId, body.role],
      );
      await client.query('commit');
      return { invitationId: id, merchantId, invitedUserId: inviteeId, role: body.role, status: 'pending', expiresInDays: 7 };
    } catch (error: any) {
      await client.query('rollback').catch(() => undefined);
      if (error?.code === '23505') throw new ConflictException('A pending invitation already exists for this user');
      throw error;
    } finally {
      client.release();
    }
  }

  async listInvitations(userId: string, merchantId: string) {
    await this.membership(userId, merchantId, ['owner','admin']);
    const result = await this.pool.query(
      `select i.id as "invitationId",i.invited_user_id as "invitedUserId",u.phone,i.role,
       case when i.status='pending' and i.expires_at<=now() then 'expired' else i.status end as status,
       i.expires_at as "expiresAt",i.created_at as "createdAt"
       from merchant_invitations i join users u on u.id=i.invited_user_id
       where i.merchant_id=$1 order by i.created_at desc`,
      [merchantId],
    );
    return result.rows;
  }

  async listMyInvitations(userId: string) {
    const result = await this.pool.query(
      `select i.id as "invitationId",i.merchant_id as "merchantId",m.display_name as "merchantName",
       m.country_code as "countryCode",i.role,i.status,i.expires_at as "expiresAt",
       i.created_at as "createdAt",u.phone as "invitedByPhone"
       from merchant_invitations i
       join merchants m on m.id=i.merchant_id
       join users u on u.id=i.invited_by
       where i.invited_user_id=$1 and i.status='pending' and i.expires_at>now()
       order by i.created_at desc`,
      [userId],
    );
    return result.rows;
  }

  async acceptInvitation(userId: string, invitationId: string) {
    const client = await this.pool.connect();
    let expired = false;
    try {
      await client.query('begin');
      const invitation = await client.query(
        'select * from merchant_invitations where id=$1 for update',
        [invitationId],
      );
      if (!invitation.rows[0] || invitation.rows[0].invited_user_id !== userId) {
        throw new NotFoundException('Invitation not found');
      }
      const row = invitation.rows[0];
      if (row.status !== 'pending') throw new ConflictException('This invitation is no longer pending');
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query(
          "update merchant_invitations set status='expired',updated_at=now() where id=$1",
          [invitationId],
        );
        await client.query('commit');
        expired = true;
      } else {
        await client.query('select id from merchants where id=$1 for update', [row.merchant_id]);
        const existing = await client.query(
          'select 1 from merchant_members where merchant_id=$1 and user_id=$2',
          [row.merchant_id, userId],
        );
        if (existing.rows[0]) throw new ConflictException('You are already a member of this merchant');
        await client.query(
          'insert into merchant_members(merchant_id,user_id,role) values($1,$2,$3)',
          [row.merchant_id, userId, row.role],
        );
        await client.query(
          "update merchant_invitations set status='accepted',accepted_at=now(),updated_at=now() where id=$1",
          [invitationId],
        );
        await client.query('commit');
      }
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (expired) throw new ConflictException('This invitation has expired');
    return { invitationId, accepted: true };
  }

  async revokeInvitation(actorUserId: string, merchantId: string, invitationId: string) {
    await this.membership(actorUserId, merchantId, ['owner','admin']);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from merchants where id=$1 for update', [merchantId]);
      const actor = await client.query(
        'select role from merchant_members where merchant_id=$1 and user_id=$2 for update',
        [merchantId, actorUserId],
      );
      if (!actor.rows[0] || !['owner','admin'].includes(actor.rows[0].role)) {
        throw new ForbiddenException('Insufficient merchant permissions');
      }
      const invitation = await client.query(
        'select role,status from merchant_invitations where id=$1 and merchant_id=$2 for update',
        [invitationId, merchantId],
      );
      if (!invitation.rows[0]) throw new NotFoundException('Invitation not found');
      if (invitation.rows[0].status !== 'pending') throw new ConflictException('Only pending invitations can be revoked');
      if (actor.rows[0].role !== 'owner' && invitation.rows[0].role === 'admin') {
        throw new ForbiddenException('Only the merchant owner can revoke an admin invitation');
      }
      await client.query(
        "update merchant_invitations set status='revoked',revoked_at=now(),updated_at=now() where id=$1",
        [invitationId],
      );
      await client.query('commit');
      return { invitationId, status: 'revoked' };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listMembers(userId: string, merchantId: string) {
    await this.membership(userId, merchantId);
    const result = await this.pool.query(
      `select mm.user_id as "userId", u.phone, mm.role, mm.created_at as "createdAt"
       from merchant_members mm join users u on u.id=mm.user_id
       where mm.merchant_id=$1 order by case mm.role when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end, mm.created_at asc`,
      [merchantId],
    );
    return result.rows;
  }

  async updateMemberRole(
    actorUserId: string, merchantId: string, targetUserId: string, body: UpdateMerchantMemberRoleDto,
  ) {
    if (actorUserId === targetUserId) throw new BadRequestException('You cannot change your own merchant role');
    const actor = await this.membership(actorUserId, merchantId, ['owner','admin']);
    if (actor.role !== 'owner' && body.role === 'admin') {
      throw new ForbiddenException('Only the merchant owner can assign admin access');
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from merchants where id=$1 for update', [merchantId]);
      const actorRow = await client.query(
        'select role from merchant_members where merchant_id=$1 and user_id=$2 for update',
        [merchantId, actorUserId],
      );
      const target = await client.query(
        'select role from merchant_members where merchant_id=$1 and user_id=$2 for update',
        [merchantId, targetUserId],
      );
      if (!actorRow.rows[0] || !['owner','admin'].includes(actorRow.rows[0].role)) {
        throw new ForbiddenException('Insufficient merchant permissions');
      }
      if (!target.rows[0]) throw new NotFoundException('Merchant member not found');
      if (target.rows[0].role === 'owner') throw new ForbiddenException('The merchant owner role cannot be changed');
      if (actorRow.rows[0].role !== 'owner' && target.rows[0].role === 'admin') {
        throw new ForbiddenException('Only the merchant owner can manage admin access');
      }
      if (actorRow.rows[0].role !== 'owner' && body.role === 'admin') {
        throw new ForbiddenException('Only the merchant owner can assign admin access');
      }
      await client.query(
        'update merchant_members set role=$3 where merchant_id=$1 and user_id=$2',
        [merchantId, targetUserId, body.role],
      );
      await client.query('commit');
      return { merchantId, userId: targetUserId, role: body.role };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(actorUserId: string, merchantId: string, targetUserId: string) {
    if (actorUserId === targetUserId) throw new BadRequestException('You cannot remove yourself from the merchant');
    await this.membership(actorUserId, merchantId, ['owner','admin']);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from merchants where id=$1 for update', [merchantId]);
      const actor = await client.query(
        'select role from merchant_members where merchant_id=$1 and user_id=$2 for update',
        [merchantId, actorUserId],
      );
      const target = await client.query(
        'select role from merchant_members where merchant_id=$1 and user_id=$2 for update',
        [merchantId, targetUserId],
      );
      if (!actor.rows[0] || !['owner','admin'].includes(actor.rows[0].role)) {
        throw new ForbiddenException('Insufficient merchant permissions');
      }
      if (!target.rows[0]) throw new NotFoundException('Merchant member not found');
      if (target.rows[0].role === 'owner') throw new ForbiddenException('The merchant owner cannot be removed');
      if (actor.rows[0].role !== 'owner' && target.rows[0].role === 'admin') {
        throw new ForbiddenException('Only the merchant owner can remove an admin');
      }
      await client.query(
        'delete from merchant_members where merchant_id=$1 and user_id=$2',
        [merchantId, targetUserId],
      );
      await client.query('commit');
      return { merchantId, userId: targetUserId, removed: true };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async submitKyb(userId: string, merchantId: string, body: SubmitKybDto) {
    const merchant = await this.membership(userId, merchantId, ['owner','admin']);
    if (merchant.kyb_status === 'approved') throw new ConflictException('Merchant KYB is already approved');
    if (merchant.kyb_status === 'rejected') throw new ConflictException('Rejected KYB requires a new compliance review');
    const caseId = randomUUID();
    await this.pool.query(
      `insert into merchant_kyb_cases(id,merchant_id,status,submitted_by,document_types,registration_number)
       values($1,$2,'submitted',$3,$4::jsonb,$5)`,
      [caseId, merchantId, userId, JSON.stringify(body.documentTypes), body.registrationNumber.trim()],
    );
    await this.pool.query(
      "update merchants set kyb_status='pending',status='pending',updated_at=now() where id=$1",
      [merchantId],
    );
    return { caseId, status: 'submitted', kybStatus: 'pending', paymentsEnabled: false };
  }

  private async requireApprovedMerchant(userId: string, merchantId: string, roles = ['owner','admin','manager']) {
    const merchant = await this.membership(userId, merchantId, roles);
    if (merchant.kyb_status !== 'approved' || merchant.status !== 'active') {
      throw new ForbiddenException('Merchant KYB approval is required before publishing commerce features');
    }
    return merchant;
  }

  async analytics(userId: string, merchantId: string, from?: string, to?: string) {
    await this.membership(userId, merchantId);
    const isDate = (value?: string) => !!value && /^\\d{4}-\\d{2}-\\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
      && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    const today = new Date().toISOString().slice(0, 10);
    const endDate = to ?? today;
    if (!isDate(endDate)) {
      throw new BadRequestException('Analytics dates must be valid YYYY-MM-DD values with from on or before to');
    }
    const startDate = from ?? new Date(Date.parse(`${endDate}T00:00:00.000Z`) - 29 * 86400000).toISOString().slice(0, 10);
    if (!isDate(startDate) || startDate > endDate || Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`) > 365 * 86400000) {
      throw new BadRequestException('Analytics dates must be valid YYYY-MM-DD values with from on or before to');
    }
    const result = await this.pool.query(
      `select currency,
        count(*)::int as link_count,
        count(*) filter (where status='paid')::int as paid_count,
        coalesce(sum(amount) filter (where status='paid'),0)::text as paid_volume_minor,
        count(*) filter (where status in ('open','processing'))::int as open_count,
        count(*) filter (where status in ('cancelled','expired'))::int as inactive_count
       from payment_links
       where merchant_id=$1 and created_at >= $2::date
         and created_at < ($3::date + interval '1 day')
       group by currency order by currency`,
      [merchantId, startDate, endDate],
    );
    const currencies = result.rows.map((row: any) => {
      const linkCount = Number(row.link_count);
      const paidCount = Number(row.paid_count);
      return {
        currency: row.currency,
        linkCount,
        paidCount,
        paidVolumeMinor: String(row.paid_volume_minor),
        openCount: Number(row.open_count),
        inactiveCount: Number(row.inactive_count),
        conversionBps: linkCount ? Math.round((paidCount / linkCount) * 10000) : 0,
      };
    });
    return {
      merchantId,
      period: { from: startDate, to: endDate, basis: 'payment_link_created_at' },
      totals: {
        linkCount: currencies.reduce((sum, item) => sum + item.linkCount, 0),
        paidCount: currencies.reduce((sum, item) => sum + item.paidCount, 0),
        openCount: currencies.reduce((sum, item) => sum + item.openCount, 0),
        inactiveCount: currencies.reduce((sum, item) => sum + item.inactiveCount, 0),
      },
      currencies,
      note: 'Paid volume is grouped by payment-link currency. Amounts are minor units and currencies are never combined.',
    };
  }

  async createPaymentLink(userId: string, merchantId: string, body: CreateMerchantLinkDto) {
    await this.requireApprovedMerchant(userId, merchantId);
    const currency = body.currency.trim().toUpperCase();
    if (!getMarketByCurrency(currency)) throw new BadRequestException('Unsupported payment link currency');
    const account = await this.pool.query(
      'select ledger_account_id from merchant_accounts where merchant_id=$1 and currency=$2',
      [merchantId, currency],
    );
    if (!account.rows[0]) throw new BadRequestException('Create a merchant account in this currency first');
    const id = randomUUID();
    const code = randomBytes(9).toString('base64url');
    await this.pool.query(
      `insert into payment_links(id,code,merchant_account,amount,description,currency,merchant_id)
       values($1,$2,$3,$4,$5,$6,$7)`,
      [id, code, account.rows[0].ledger_account_id, body.amount, body.description ?? null, currency, merchantId],
    );
    const checkoutPath = `/links/${code}`;
    return { id, code, amount: body.amount, currency, description: body.description ?? null,
      status: 'open', checkoutPath, qrPayload: checkoutPath, settlementStatus: 'blocked' };
  }

  async createOffer(userId: string, merchantId: string, body: CreateOfferDto) {
    await this.requireApprovedMerchant(userId, merchantId);
    const id = randomUUID();
    await this.pool.query(
      "insert into merchant_offers(id,merchant_id,name,description,status) values($1,$2,$3,$4,'draft')",
      [id, merchantId, body.name.trim(), body.description?.trim() ?? null],
    );
    return { offerId: id, status: 'draft', published: false };
  }

  async listOffers(userId: string, merchantId: string) {
    await this.membership(userId, merchantId);
    const result = await this.pool.query(
      'select id,name,description,status,starts_at,ends_at,created_at from merchant_offers where merchant_id=$1 order by created_at desc',
      [merchantId],
    );
    return result.rows;
  }

  async createCampaign(userId: string, merchantId: string, body: CreateCampaignDto) {
    const merchant = await this.requireApprovedMerchant(userId, merchantId);
    const currency = body.currency.trim().toUpperCase();
    if (currency !== merchant.currency) throw new BadRequestException('Campaign currency must match the merchant settlement currency');
    const budget = body.budgetMinor;
    const id = randomUUID();
    await this.pool.query(
      `insert into reward_campaigns(id,owner_id,merchant_id,name,funding_source,currency,budget_minor,points_per_minor,max_points_per_user,status)
       values($1,$2,$3,$4,'merchant',$5,$6,$7,$8,'pending_funding')`,
      [id, userId, merchantId, body.name.trim(), currency, budget, body.pointsPerMinor, body.maxPointsPerUser ?? null],
    );
    return { campaignId: id, status: 'pending_funding', funded: false, pointsIssuanceEnabled: false };
  }

  async listCampaigns(userId: string, merchantId: string) {
    await this.membership(userId, merchantId);
    const result = await this.pool.query(
      'select id,name,currency,budget_minor,spent_minor,points_per_minor,status,starts_at,ends_at from reward_campaigns where merchant_id=$1 order by created_at desc',
      [merchantId],
    );
    return result.rows.map((row: any) => ({ ...row, budget_minor: Number(row.budget_minor), spent_minor: Number(row.spent_minor) }));
  }

  async pendingKyb() {
    const result = await this.pool.query(
      `select c.id as case_id,c.status as case_status,c.document_types,c.submitted_at,
       m.id as merchant_id,m.legal_name,m.display_name,m.country_code,m.currency
       from merchant_kyb_cases c join merchants m on m.id=c.merchant_id
       where c.status in ('submitted','under_review') order by c.submitted_at asc`,
    );
    return result.rows;
  }

  async decideKyb(adminUserId: string, merchantId: string, body: KybDecisionDto) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const merchant = await client.query('select id,kyb_status,status from merchants where id=$1 for update', [merchantId]);
      if (!merchant.rows[0]) throw new NotFoundException('Merchant not found');
      const kybCase = await client.query(
        "select id from merchant_kyb_cases where merchant_id=$1 and status in ('submitted','under_review','needs_info') order by submitted_at desc limit 1 for update",
        [merchantId],
      );
      if (!kybCase.rows[0]) throw new ConflictException('No open KYB case exists for this merchant');
      const nextStatus = body.decision;
      const merchantStatus = nextStatus === 'approved' ? 'active' : nextStatus === 'rejected' ? 'suspended' : 'pending';
      await client.query(
        'update merchant_kyb_cases set status=$2,reviewed_by=$3,decision_reason=$4,reviewed_at=now() where id=$1',
        [kybCase.rows[0].id, nextStatus, adminUserId, body.reason ?? null],
      );
      await client.query(
        'update merchants set kyb_status=$2,status=$3,updated_at=now() where id=$1',
        [merchantId, nextStatus, merchantStatus],
      );
      await client.query(
        'insert into admin_audit_events(id,actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5,$6::jsonb)',
        [randomUUID(), adminUserId, 'merchant_kyb_decision', 'merchant', merchantId,
          JSON.stringify({ decision: nextStatus, reason: body.reason ?? null })],
      );
      await client.query('commit');
      return { merchantId, kybStatus: nextStatus, status: merchantStatus, settlementStatus: 'blocked', paymentsEnabled: false };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

@Controller('merchants')
@UseGuards(AuthGuard)
class MerchantController {
  constructor(private readonly merchants: MerchantService) {}

  @Post() create(@CurrentUser() user: AuthUser, @Body() body: CreateMerchantDto) {
    return this.merchants.create(user, body);
  }
  @Get('me') listMine(@CurrentUser() user: AuthUser) { return this.merchants.listMine(user.id); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.merchants.get(user.id, id); }
  @Post(':id/accounts') createAccount(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateMerchantAccountDto) {
    return this.merchants.createAccount(user.id, id, body);
  }
  @Post(':id/stores') createStore(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateMerchantStoreDto,
  ) {
    return this.merchants.createStore(user.id, id, body);
  }
  @Get(':id/stores') listStores(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.merchants.listStores(user.id, id);
  }
  @Patch(':id/stores/:storeId') updateStore(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('storeId') storeId: string,
    @Body() body: UpdateMerchantStoreDto,
  ) {
    return this.merchants.updateStore(user.id, id, storeId, body);
  }
  @Post(':id/invitations') createInvitation(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateMerchantInvitationDto,
  ) {
    return this.merchants.createInvitation(user.id, id, body);
  }
  @Get(':id/invitations') listInvitations(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.merchants.listInvitations(user.id, id);
  }
  @Delete(':id/invitations/:invitationId') revokeInvitation(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('invitationId') invitationId: string,
  ) {
    return this.merchants.revokeInvitation(user.id, id, invitationId);
  }
  @Get(':id/members') listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.merchants.listMembers(user.id, id);
  }
  @Patch(':id/members/:userId/role') updateMemberRole(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string,
    @Body() body: UpdateMerchantMemberRoleDto,
  ) {
    return this.merchants.updateMemberRole(user.id, id, userId, body);
  }
  @Delete(':id/members/:userId') removeMember(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string,
  ) {
    return this.merchants.removeMember(user.id, id, userId);
  }
  @Post(':id/kyb/submit') submitKyb(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: SubmitKybDto) {
    return this.merchants.submitKyb(user.id, id, body);
  }
  @Get(':id/analytics') analytics(
    @CurrentUser() user: AuthUser, @Param('id') id: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    return this.merchants.analytics(user.id, id, from, to);
  }
  @Post(':id/payment-links') createPaymentLink(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateMerchantLinkDto) {
    return this.merchants.createPaymentLink(user.id, id, body);
  }
  @Post(':id/offers') createOffer(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateOfferDto) {
    return this.merchants.createOffer(user.id, id, body);
  }
  @Get(':id/offers') listOffers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.merchants.listOffers(user.id, id);
  }
  @Post(':id/campaigns') createCampaign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: CreateCampaignDto) {
    return this.merchants.createCampaign(user.id, id, body);
  }
  @Get(':id/campaigns') listCampaigns(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.merchants.listCampaigns(user.id, id);
  }
}

@Controller('merchant-invitations')
@UseGuards(AuthGuard)
class MerchantInvitationController {
  constructor(private readonly merchants: MerchantService) {}
  @Get('me') listMine(@CurrentUser() user: AuthUser) {
    return this.merchants.listMyInvitations(user.id);
  }
  @Post(':id/accept') accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.merchants.acceptInvitation(user.id, id);
  }
}

@Controller('admin/merchants')
@UseGuards(AuthGuard, AdminGuard)
class MerchantAdminController {
  constructor(private readonly merchants: MerchantService) {}

  @Get('kyb') pendingKyb() { return this.merchants.pendingKyb(); }
  @Post(':id/kyb/decision') decideKyb(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: KybDecisionDto) {
    return this.merchants.decideKyb(user.id, id, body);
  }
}

@Module({
  imports: [AuthModule, LedgerModule],
  controllers: [MerchantController, MerchantInvitationController, MerchantAdminController],
  providers: [MerchantService, AdminGuard],
  exports: [MerchantService],
})
export class MerchantModule {}
