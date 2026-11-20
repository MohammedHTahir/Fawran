import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { canMoveRealMoney, getMarketProfile, listMarketProfiles } from '../markets/market-registry';

const GATE_KEYS = [
  'legal_opinion', 'regulatory_permission', 'licensed_partner', 'kyc_aml_controls',
  'security_assessment', 'settlement_reconciliation', 'support_readiness', 'customer_disclosures',
] as const;
type GateKey = typeof GATE_KEYS[number];

@Injectable()
export class OperationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async overview() {
    const [risk, support, settlements, payouts, payments] = await Promise.all([
      this.pool.query("select count(*)::int as count from risk_cases where status in ('open','under_review')"),
      this.pool.query("select count(*)::int as count from support_cases where status in ('open','in_progress','waiting_customer')"),
      this.pool.query("select count(*)::int as count from reconciliation_exceptions where status='open'"),
      this.pool.query("select count(*)::int as count from payout_requests where status='blocked'"),
      this.pool.query('select status,count(*)::int as count from payment_intents group by status'),
    ]);
    return {
      openRiskCases: Number(risk.rows[0]?.count ?? 0),
      openSupportCases: Number(support.rows[0]?.count ?? 0),
      openReconciliationExceptions: Number(settlements.rows[0]?.count ?? 0),
      blockedPayoutRequests: Number(payouts.rows[0]?.count ?? 0),
      paymentIntents: payments.rows.map((row) => ({ status: row.status, count: Number(row.count) })),
      realMoneyEnabled: false,
    };
  }

  async listMarkets() {
    const result = await this.pool.query('select * from market_gate_reviews order by country_code,gate_key');
    const byCountry = new Map<string, any[]>();
    for (const row of result.rows) {
      const entries = byCountry.get(row.country_code) ?? [];
      entries.push(row);
      byCountry.set(row.country_code, entries);
    }
    return listMarketProfiles().map((market) => {
      const saved = byCountry.get(market.countryCode) ?? [];
      const gates = GATE_KEYS.map((key) => saved.find((row) => row.gate_key === key) ?? {
        country_code: market.countryCode, currency: market.currency, gate_key: key, status: 'not_started',
      });
      return {
        ...market,
        gates,
        readinessComplete: gates.every((gate) => gate.status === 'verified'),
        realMoneyEnabled: canMoveRealMoney(market.countryCode),
      };
    });
  }

  async createRiskCase(actorId: string, input: {
    countryCode: string; category: string; severity: string; summary: string;
    userId?: string; merchantId?: string; paymentIntentId?: string; details?: Record<string, unknown>;
  }) {
    const countryCode = input.countryCode.trim().toUpperCase();
    if (!getMarketProfile(countryCode)) throw new BadRequestException('Unknown market code');
    if (!input.userId && !input.merchantId && !input.paymentIntentId) {
      throw new BadRequestException('A user, merchant or payment-intent reference is required');
    }
    const id = randomUUID();
    await this.pool.query(
      `insert into risk_cases(id,country_code,category,severity,user_id,merchant_id,payment_intent_id,summary,details,created_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [id, countryCode, input.category, input.severity, input.userId ?? null, input.merchantId ?? null,
        input.paymentIntentId ?? null, input.summary.trim(), JSON.stringify(input.details ?? {}), actorId],
    );
    await this.audit(actorId, 'risk_case.created', 'risk_case', id, { countryCode, category: input.category, severity: input.severity });
    return { id, countryCode, category: input.category, severity: input.severity, status: 'open' };
  }

  async listRiskCases(status?: string) {
    if (status && !['open','under_review','resolved','false_positive'].includes(status)) {
      throw new BadRequestException('Invalid risk case status filter');
    }
    const result = await this.pool.query(
      'select * from risk_cases where ($1::text is null or status=$1) order by case severity when \'critical\' then 0 when \'high\' then 1 when \'medium\' then 2 else 3 end,created_at desc limit 200',
      [status ?? null],
    );
    return result.rows;
  }

  async resolveRiskCase(actorId: string, id: string, status: 'resolved'|'false_positive', note: string) {
    const result = await this.pool.query(
      `update risk_cases set status=$2,resolution_note=$3,updated_at=now(),resolved_at=now()
        where id=$1 and status in ('open','under_review') returning id,country_code,status`,
      [id, status, note.trim()],
    );
    if (!result.rows[0]) throw new NotFoundException('Open risk case not found');
    await this.audit(actorId, 'risk_case.resolved', 'risk_case', id, { status, note: note.trim() });
    return result.rows[0];
  }

  async createSupportCase(userId: string, input: { category: string; subject: string; description: string }) {
    const id = randomUUID();
    await this.pool.query(
      'insert into support_cases(id,user_id,category,subject,description) values($1,$2,$3,$4,$5)',
      [id, userId, input.category, input.subject.trim(), input.description.trim()],
    );
    return { id, category: input.category, subject: input.subject.trim(), status: 'open', priority: 'normal' };
  }

  async listMySupportCases(userId: string) {
    const result = await this.pool.query('select * from support_cases where user_id=$1 order by created_at desc limit 100', [userId]);
    return result.rows;
  }

  async listSupportCases(status?: string) {
    if (status && !['open','in_progress','waiting_customer','resolved','closed'].includes(status)) {
      throw new BadRequestException('Invalid support case status filter');
    }
    const result = await this.pool.query(
      'select * from support_cases where ($1::text is null or status=$1) order by case priority when \'urgent\' then 0 when \'high\' then 1 when \'normal\' then 2 else 3 end,created_at desc limit 200',
      [status ?? null],
    );
    return result.rows;
  }

  async updateSupportCase(actorId: string, id: string, status: 'in_progress'|'waiting_customer'|'resolved'|'closed', note?: string) {
    const result = await this.pool.query(
      `update support_cases set status=$2,resolution_note=$3,updated_at=now(),
          resolved_at=case when $2 in ('resolved','closed') then coalesce(resolved_at,now()) else null end
        where id=$1 returning id,status`,
      [id, status, note?.trim() ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Support case not found');
    await this.audit(actorId, 'support_case.status_updated', 'support_case', id, { status, note: note?.trim() ?? null });
    return result.rows[0];
  }

  async submitMarketGate(actorId: string, countryCodeRaw: string, gateKey: string, evidenceReference: string, note: string) {
    const countryCode = countryCodeRaw.trim().toUpperCase();
    const market = getMarketProfile(countryCode);
    if (!market) throw new BadRequestException('Unknown market code');
    if (!GATE_KEYS.includes(gateKey as GateKey)) throw new BadRequestException('Unknown market readiness gate');
    const existing = await this.pool.query(
      'select status from market_gate_reviews where country_code=$1 and gate_key=$2',
      [countryCode, gateKey],
    );
    if (existing.rows[0]?.status === 'verified') throw new ConflictException('Verified market gate cannot be resubmitted');
    await this.pool.query(
      `insert into market_gate_reviews(country_code,currency,gate_key,status,evidence_reference,submission_note,submitted_by,submitted_at)
       values($1,$2,$3,'in_progress',$4,$5,$6,now())
       on conflict(country_code,gate_key) do update set status='in_progress',evidence_reference=excluded.evidence_reference,
         submission_note=excluded.submission_note,submitted_by=excluded.submitted_by,submitted_at=now(),
         approved_by=null,approval_note=null,approved_at=null,updated_at=now()`,
      [countryCode, market.currency, gateKey, evidenceReference.trim(), note.trim(), actorId],
    );
    await this.audit(actorId, 'market_gate.submitted', 'market_gate_review', countryCode + ':' + gateKey, { evidenceReference: evidenceReference.trim() });
    return { countryCode, gateKey, status: 'in_progress', realMoneyEnabled: false };
  }

  async blockMarketGate(actorId: string, countryCodeRaw: string, gateKey: string, note: string) {
    const countryCode = countryCodeRaw.trim().toUpperCase();
    const market = getMarketProfile(countryCode);
    if (!market) throw new BadRequestException('Unknown market code');
    if (!GATE_KEYS.includes(gateKey as GateKey)) throw new BadRequestException('Unknown market readiness gate');
    const result = await this.pool.query(
      `insert into market_gate_reviews(country_code,currency,gate_key,status,submission_note,submitted_by,submitted_at)
       values($1,$2,$3,'blocked',$4,$5,now())
       on conflict(country_code,gate_key) do update set status='blocked',submission_note=excluded.submission_note,
         submitted_by=excluded.submitted_by,submitted_at=now(),approved_by=null,approval_note=null,approved_at=null,updated_at=now()
       returning status`,
      [countryCode, market.currency, gateKey, note.trim(), actorId],
    );
    await this.audit(actorId, 'market_gate.blocked', 'market_gate_review', countryCode + ':' + gateKey, { note: note.trim() });
    return { countryCode, gateKey, status: result.rows[0].status, realMoneyEnabled: false };
  }

  async approveMarketGate(actorId: string, countryCodeRaw: string, gateKey: string, note: string) {
    const countryCode = countryCodeRaw.trim().toUpperCase();
    const existing = await this.pool.query(
      'select status,submitted_by,evidence_reference from market_gate_reviews where country_code=$1 and gate_key=$2',
      [countryCode, gateKey],
    );
    if (!existing.rows[0] || existing.rows[0].status !== 'in_progress' || !existing.rows[0].evidence_reference) {
      throw new ConflictException('Market gate must have submitted evidence before approval');
    }
    if (existing.rows[0].submitted_by === actorId) throw new ForbiddenException('Market gate approval requires a different administrator');
    const updated = await this.pool.query(
      `update market_gate_reviews set status='verified',approved_by=$3,approval_note=$4,approved_at=now(),updated_at=now()
        where country_code=$1 and gate_key=$2 returning status`,
      [countryCode, gateKey, actorId, note.trim()],
    );
    await this.audit(actorId, 'market_gate.verified', 'market_gate_review', countryCode + ':' + gateKey, { note: note.trim() });
    return { countryCode, gateKey, status: updated.rows[0].status, realMoneyEnabled: false };
  }

  async listReconciliationExceptions(status?: string) {
    if (status && !['open', 'resolved', 'ignored'].includes(status)) {
      throw new BadRequestException('Invalid reconciliation exception status filter');
    }
    const result = await this.pool.query(
      `select e.id,e.batch_id,e.settlement_line_id,e.kind,e.details,e.status,e.created_at,
              e.resolved_at,e.resolved_by,b.provider_name,b.external_batch_id,b.currency as batch_currency,
              b.settlement_date,l.line_number,l.provider_ref,l.line_type,l.gross_amount_minor,
              l.fee_amount_minor,l.net_amount_minor,l.currency as line_currency,l.match_status
         from reconciliation_exceptions e
         join settlement_batches b on b.id=e.batch_id
         join settlement_lines l on l.id=e.settlement_line_id
        where ($1::text is null or e.status=$1)
        order by case e.status when 'open' then 0 when 'resolved' then 1 else 2 end,e.created_at desc
        limit 200`,
      [status ?? null],
    );
    return result.rows.map((row) => ({
      ...row,
      gross_amount_minor: Number(row.gross_amount_minor),
      fee_amount_minor: Number(row.fee_amount_minor),
      net_amount_minor: Number(row.net_amount_minor),
    }));
  }

  async decideReconciliationException(
    actorId: string, id: string, status: 'resolved' | 'ignored', note: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query(
        'select id,status,kind,batch_id,details from reconciliation_exceptions where id=$1 for update',
        [id],
      );
      if (!current.rows[0]) throw new NotFoundException('Reconciliation exception not found');
      if (current.rows[0].status !== 'open') {
        throw new ConflictException('Only open reconciliation exceptions can be decided');
      }
      const details = { status, note: note.trim(), decidedBy: actorId, decidedAt: new Date().toISOString() };
      const updated = await client.query(
        `update reconciliation_exceptions
            set status=$2,resolved_at=now(),resolved_by=$3,
                details=$4::jsonb
          where id=$1 and status='open'
          returning id,status,kind,batch_id,resolved_at,resolved_by`,
        [id, status, actorId, JSON.stringify({ ...(current.rows[0].details ?? {}), decision: details })],
      );
      if (!updated.rows[0]) throw new ConflictException('Reconciliation exception was decided concurrently');
      await client.query(
        `insert into admin_audit_events(id,actor_user_id,action,entity_type,entity_id,details)
         values($1,$2,$3,'reconciliation_exception',$4,$5::jsonb)`,
        [randomUUID(), actorId, 'reconciliation_exception.' + status, id,
          JSON.stringify({ kind: current.rows[0].kind, batchId: current.rows[0].batch_id, note: note.trim() })],
      );
      await client.query('commit');
      return updated.rows[0];
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async auditTrail() {
    const result = await this.pool.query(
      'select id,actor_user_id,action,entity_type,entity_id,details,created_at from admin_audit_events order by created_at desc limit 200',
    );
    return result.rows;
  }

  private async audit(actorId: string, action: string, entityType: string, entityId: string, details: Record<string, unknown>) {
    await this.pool.query(
      'insert into admin_audit_events(id,actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5,$6::jsonb)',
      [randomUUID(), actorId, action, entityType, entityId, JSON.stringify(details)],
    );
  }
}
