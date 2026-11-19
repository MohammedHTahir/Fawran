import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { INestApplication } from '@nestjs/common';
import { MerchantService } from '../src/merchants/merchants.module';
import { makeApp } from './helpers';

describe('merchant campaign governance', () => {
  let app: INestApplication;
  let pool: any;
  let merchants: MerchantService;

  beforeEach(async () => {
    const created = await makeApp();
    app = created.app;
    pool = created.pool;
    merchants = app.get(MerchantService);
    await pool.query(
      'insert into users(id,phone) values($1,$2),($3,$4),($5,$6)',
      ['campaign-owner','01012345678','campaign-admin','01012345679','campaign-manager','01012345670'],
    );
    await pool.query(
      `insert into merchants(id,owner_user_id,legal_name,display_name,country_code,currency,kyb_status,status)
       values('campaign-merchant','campaign-owner','Merchant LLC','Merchant','EG','EGP','approved','active')`,
    );
    await pool.query(
      `insert into merchant_members(merchant_id,user_id,role) values
       ('campaign-merchant','campaign-owner','owner'),
       ('campaign-merchant','campaign-manager','manager')`,
    );
    await pool.query(
      `insert into reward_campaigns
       (id,owner_id,merchant_id,name,funding_source,currency,budget_minor,points_per_minor,status)
       values('campaign-1','campaign-owner','campaign-merchant','Test campaign','merchant','EGP',100000,2,'pending_funding')`,
    );
  });

  afterEach(async () => { await app.close(); });

  it('requires owner/admin membership to submit and records the submission audit event', async () => {
    await expect(merchants.submitCampaignForReview('campaign-manager','campaign-merchant','campaign-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    const result = await merchants.submitCampaignForReview('campaign-owner','campaign-merchant','campaign-1');
    expect(result).toMatchObject({ campaignId:'campaign-1',status:'pending_review',funded:false,pointsIssuanceEnabled:false });
    const events = await merchants.campaignAuditHistory('campaign-manager','campaign-merchant','campaign-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId:'campaign-owner',action:'submitted',fromStatus:'pending_funding',toStatus:'pending_review',
    });
  });

  it('requires an independent admin decision and keeps approved campaigns unfunded', async () => {
    await merchants.submitCampaignForReview('campaign-owner','campaign-merchant','campaign-1');
    await expect(merchants.decideCampaignReview('campaign-owner','campaign-1',{decision:'approved'} as any))
      .rejects.toBeInstanceOf(ForbiddenException);
    const result = await merchants.decideCampaignReview('campaign-admin','campaign-1',{decision:'approved'} as any);
    expect(result).toMatchObject({ status:'approved',funded:false,pointsIssuanceEnabled:false });
    const campaign = await pool.query(
      'select status,funded_minor,reserved_minor,spent_minor from reward_campaigns where id=$1',
      ['campaign-1'],
    );
    expect(campaign.rows[0]).toMatchObject({ status:'approved',funded_minor:0,reserved_minor:0,spent_minor:0 });
    const events = await merchants.campaignAuditHistory('campaign-owner','campaign-merchant','campaign-1');
    expect(events.map((event: any) => event.action)).toEqual(['submitted','approved']);
  });

  it('requires a rejection reason and allows a rejected campaign to be resubmitted', async () => {
    await merchants.submitCampaignForReview('campaign-owner','campaign-merchant','campaign-1');
    await expect(merchants.decideCampaignReview('campaign-admin','campaign-1',{decision:'rejected'} as any))
      .rejects.toBeInstanceOf(BadRequestException);
    await merchants.decideCampaignReview('campaign-admin','campaign-1',{decision:'rejected',reason:'Clarify the campaign terms'} as any);
    const resubmitted = await merchants.submitCampaignForReview('campaign-owner','campaign-merchant','campaign-1');
    expect(resubmitted.status).toBe('pending_review');
    const events = await merchants.campaignAuditHistory('campaign-owner','campaign-merchant','campaign-1');
    expect(events.map((event: any) => event.action)).toEqual(['submitted','rejected','resubmitted']);
  });

  it('blocks decisions outside the pending-review state', async () => {
    await expect(merchants.decideCampaignReview('campaign-admin','campaign-1',{decision:'approved'} as any))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('archives only unfunded non-review campaigns and records the actor', async () => {
    const archived = await merchants.archiveCampaign('campaign-owner','campaign-merchant','campaign-1');
    expect(archived).toMatchObject({ status:'archived',funded:false,pointsIssuanceEnabled:false });
    const events = await merchants.campaignAuditHistory('campaign-owner','campaign-merchant','campaign-1');
    expect(events[0]).toMatchObject({ action:'archived',fromStatus:'pending_funding',toStatus:'archived' });
    await expect(merchants.archiveCampaign('campaign-owner','campaign-merchant','campaign-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('does not approve a campaign if merchant KYB is no longer approved', async () => {
    await merchants.submitCampaignForReview('campaign-owner','campaign-merchant','campaign-1');
    await pool.query("update merchants set kyb_status='needs_info' where id='campaign-merchant'");
    await expect(merchants.decideCampaignReview('campaign-admin','campaign-1',{decision:'approved'} as any))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
