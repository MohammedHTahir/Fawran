import { BadRequestException, CanActivate, ExecutionContext, Inject, Injectable, Module, UnauthorizedException, HttpException, HttpStatus,
  Body, Controller, Post, Req, Get, Delete, Param, UseGuards, createParamDecorator } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!value || value.length < 32)) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in production');
  }
  return value ?? 'dev-only-secret-change-before-deployment';
};

/** Accepts 01xxxxxxxxx, +201xxxxxxxxx, 00201xxxxxxxxx; returns 01xxxxxxxxx. */
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[\s-]/g, '');
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  else if (p.startsWith('0020')) p = '0' + p.slice(4);
  if (!/^01[0125][0-9]{8}$/.test(p)) throw new BadRequestException('Invalid Egyptian mobile number');
  return p;
}

export const SMS = 'SMS';
export interface SmsPort { send(phone: string, text: string): Promise<void>; }
class ConsoleSms implements SmsPort {
  async send(p: string, t: string) {
    if (process.env.NODE_ENV === 'production') throw new Error('Console SMS is forbidden in production');
    console.log(`[sms:dev] ${p}: ${t}`);
  }
}
class UnconfiguredProductionSms implements SmsPort {
  async send() { throw new Error('No production SMS adapter configured. Configure an approved SMS provider before enabling OTP.'); }
}

/** Optional Twilio Programmable Messaging adapter. Egypt sender registration is
 * an external prerequisite; this class does not bypass carrier or legal approval. */
export class TwilioSms implements SmsPort {
  static isConfigured() {
    return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM));
  }

  async send(phone: string, text: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || (!messagingServiceSid && !from)) {
      throw new Error('Twilio SMS is not fully configured');
    }
    const e164 = phone.startsWith('+') ? phone : `+20${phone.replace(/^0/, '')}`;
    const form = new URLSearchParams({ To: e164, Body: text });
    if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
    else form.set('From', from as string);
    if (process.env.TWILIO_STATUS_CALLBACK_URL) {
      form.set('StatusCallback', process.env.TWILIO_STATUS_CALLBACK_URL);
    }
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      let providerCode = 'unknown';
      try {
        const payload = await response.json() as { code?: number };
        if (payload.code) providerCode = String(payload.code);
      } catch { /* Do not surface provider response bodies or phone numbers. */ }
      throw new Error(`Twilio SMS request failed (HTTP ${response.status}, code ${providerCode})`);
    }
  }
}

export interface AuthUser { id: string; accountId: string; sessionId: string; }
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private pool: Pool) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers['authorization'] ?? '';
    try {
      const p: any = jwt.verify(h.replace(/^Bearer /, ''), secret());
      if (!p.sid || !p.sub || !p.acc) throw new UnauthorizedException();
      const active = await this.pool.query(
        'select id from auth_sessions where id=$1 and user_id=$2 and revoked_at is null and expires_at > now()',
        [p.sid, p.sub],
      );
      if (!active.rows.length) throw new UnauthorizedException();
      req.user = { id:p.sub, accountId:p.acc, sessionId:p.sid } as AuthUser;
      return true;
    } catch { throw new UnauthorizedException(); }
  }
}

const OTP_WINDOW_MS = 15 * 60_000;
const OTP_COOLDOWN_MS = 60_000;
const OTP_PHONE_LIMIT = 3;
const OTP_IP_LIMIT = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_VERIFY_IP_LIMIT = 30;
const otpPepper = () => {
  const value = process.env.OTP_PEPPER ?? (process.env.NODE_ENV === 'production' ? undefined : 'dev-only-otp-pepper-change-before-deployment');
  if (!value || value.length < 32) throw new Error('OTP_PEPPER must be configured with at least 32 characters');
  return value;
};
const digest = (value: string) => createHmac('sha256', otpPepper()).update(value).digest('hex');

const sessionPepper = () => {
  const value = process.env.SESSION_TOKEN_PEPPER ?? (process.env.NODE_ENV === 'production' ? undefined : 'dev-only-session-token-pepper-change-before-deployment');
  if (!value || value.length < 32) throw new Error('SESSION_TOKEN_PEPPER must be configured with at least 32 characters');
  return value;
};
const tokenDigest = (value: string) => createHmac('sha256', sessionPepper()).update(value).digest('hex');
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

@Injectable()
export class AuthService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(SMS) private sms: SmsPort) {}

  async requestOtp(phoneRaw: string, requesterIp: string) {
    const phone = normalizePhone(phoneRaw);
    const now = Date.now();
    const phoneKey = digest(phone);
    const ipKey = digest(requesterIp || 'unknown');
    const code = process.env.NODE_ENV === 'production' ? String(randomInt(100000, 1000000)) : '000000';
    const codeDigest = digest(`${phone}:${code}`);
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const phoneRate = await this.lockRate(c, 'phone', phoneKey, now);
      const ipRate = await this.lockRate(c, 'ip', ipKey, now);
      this.resetWindow(phoneRate, now);
      this.resetWindow(ipRate, now);
      if (phoneRate.lastSentAt && now - phoneRate.lastSentAt < OTP_COOLDOWN_MS)
        throw new BadRequestException('Please wait before requesting another code');
      if (phoneRate.count >= OTP_PHONE_LIMIT || ipRate.count >= OTP_IP_LIMIT)
        throw new BadRequestException('Too many OTP requests; try again later');
      phoneRate.count++; phoneRate.lastSentAt = now; ipRate.count++;
      await this.saveRate(c, 'phone', phoneKey, phoneRate);
      await this.saveRate(c, 'ip', ipKey, ipRate);
      await c.query(`insert into otp_challenges(phone_key,code_digest,expires_at,attempts,created_at)
        values($1,$2,$3,0,$4) on conflict(phone_key) do update set code_digest=excluded.code_digest,
        expires_at=excluded.expires_at,attempts=0,created_at=excluded.created_at`,
        [phoneKey, codeDigest, new Date(now + 5 * 60_000).toISOString(), new Date(now).toISOString()]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally { c.release(); }
    try { await this.sms.send(phone, `Your Fawran code: ${code}`); }
    catch (e) {
      await this.pool.query('delete from otp_challenges where phone_key=$1 and code_digest=$2', [phoneKey, codeDigest]);
      throw e;
    }
  }

  private async lockRate(c: any, scope: string, key: string, now: number) {
    await c.query(`insert into otp_rate_limits(scope,key_hash,window_started_at,request_count,last_sent_at)
      values($1,$2,$3,0,null) on conflict(scope,key_hash) do nothing`, [scope,key,new Date(now).toISOString()]);
    const row = (await c.query('select window_started_at,request_count,last_sent_at from otp_rate_limits where scope=$1 and key_hash=$2 for update',[scope,key])).rows[0];
    if (!row) throw new Error('Unable to lock OTP rate limit');
    return { windowStartedAt:new Date(row.window_started_at).getTime(), count:Number(row.request_count), lastSentAt:row.last_sent_at ? new Date(row.last_sent_at).getTime() : 0 };
  }
  private resetWindow(rate: any, now: number) {
    if (now-rate.windowStartedAt >= OTP_WINDOW_MS) { rate.windowStartedAt=now; rate.count=0; rate.lastSentAt=0; }
  }
  private async saveRate(c:any,scope:string,key:string,rate:any) {
    await c.query('update otp_rate_limits set window_started_at=$3,request_count=$4,last_sent_at=$5 where scope=$1 and key_hash=$2',
      [scope,key,new Date(rate.windowStartedAt).toISOString(),rate.count,rate.lastSentAt ? new Date(rate.lastSentAt).toISOString() : null]);
  }

  async verify(phoneRaw: string, code: string, requesterIp: string) {
    const phone = normalizePhone(phoneRaw);
    const phoneKey = digest(phone);
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const ipKey = digest(requesterIp || 'unknown');
      await c.query(`insert into otp_verify_rate_limits(ip_key,window_started_at,request_count)
        values($1,now(),0) on conflict(ip_key) do nothing`, [ipKey]);
      const ipRate = (await c.query('select window_started_at,request_count from otp_verify_rate_limits where ip_key=$1 for update',[ipKey])).rows[0];
      if (!ipRate) throw new Error('Unable to lock OTP verification rate limit');
      const now = Date.now();
      let windowStart = new Date(ipRate.window_started_at).getTime();
      let count = Number(ipRate.request_count);
      if (now - windowStart >= OTP_WINDOW_MS) { windowStart = now; count = 0; }
      if (count >= OTP_VERIFY_IP_LIMIT) {
        await c.query('commit');
        throw new HttpException('Too many verification attempts from this network; try again later', HttpStatus.TOO_MANY_REQUESTS);
      }
      await c.query('update otp_verify_rate_limits set window_started_at=$2,request_count=$3 where ip_key=$1',
        [ipKey,new Date(windowStart).toISOString(),count+1]);
      const row = (await c.query('select code_digest,expires_at,attempts from otp_challenges where phone_key=$1 for update',[phoneKey])).rows[0];
      if (!row || new Date(row.expires_at).getTime() <= Date.now() || Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
        if (row) await c.query('delete from otp_challenges where phone_key=$1',[phoneKey]);
        await c.query('commit');
        throw new UnauthorizedException('Code expired, request a new one');
      }
      const supplied = Buffer.from(digest(`${phone}:${code}`),'hex');
      const expected = Buffer.from(row.code_digest,'hex');
      const valid = supplied.length===expected.length && timingSafeEqual(supplied,expected);
      if (!valid) {
        const attempts=Number(row.attempts)+1;
        if (attempts>=OTP_MAX_ATTEMPTS) await c.query('delete from otp_challenges where phone_key=$1',[phoneKey]);
        else await c.query('update otp_challenges set attempts=$2 where phone_key=$1',[phoneKey,attempts]);
        await c.query('commit');
        throw new UnauthorizedException('Wrong code');
      }
      await c.query('delete from otp_challenges where phone_key=$1',[phoneKey]);
      await c.query('commit');
    } catch(e) {
      await c.query('rollback').catch(()=>undefined);
      throw e;
    } finally { c.release(); }
    const { id, accountId } = await this.findOrCreate(phone);
    return this.createSession(id, accountId);
  }

  private async createSession(userId: string, accountId: string) {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.pool.query(
      'insert into auth_sessions(id,user_id,refresh_token_hash,expires_at) values($1,$2,$3,$4)',
      [sessionId,userId,tokenDigest(refreshToken),expiresAt.toISOString()],
    );
    return {
      token: jwt.sign({ sub:userId, acc:accountId, sid:sessionId }, secret(), { expiresIn:ACCESS_TOKEN_TTL }),
      refreshToken,
      expiresAt: expiresAt.toISOString(),
      userId,
    };
  }

  async refresh(refreshToken: string) {
    const hash = tokenDigest(refreshToken);
    const c = await this.pool.connect();
    let userId: string | null = null;
    let sessionId: string | null = null;
    let rotatedToken: string | null = null;
    let expiresAt: Date | null = null;
    let reused = false;
    try {
      await c.query('begin');
      const row = (await c.query(
        'select id,user_id,refresh_token_hash,expires_at,revoked_at from auth_sessions where refresh_token_hash=$1 for update',
        [hash],
      )).rows[0];
      if (!row) {
        const consumed = (await c.query(
          'select session_id,user_id from auth_refresh_token_history where token_hash=$1 for update',
          [hash],
        )).rows[0];
        if (consumed) {
          userId = consumed.user_id;
          reused = true;
          await c.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1', [userId]);
        }
        await c.query('commit');
      } else if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        await c.query('commit');
      } else {
        userId = row.user_id;
        sessionId = row.id;
        rotatedToken = randomBytes(48).toString('base64url');
        expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
        await c.query(
          'insert into auth_refresh_token_history(token_hash,session_id,user_id) values($1,$2,$3)',
          [hash,sessionId,userId],
        );
        await c.query(
          'update auth_sessions set refresh_token_hash=$2,expires_at=$3,last_used_at=now() where id=$1',
          [sessionId,tokenDigest(rotatedToken),expiresAt.toISOString()],
        );
        await c.query('commit');
      }
    } catch(e) { await c.query('rollback').catch(()=>undefined); throw e; }
    finally { c.release(); }
    if (!userId || !sessionId || !rotatedToken || !expiresAt || reused) throw new UnauthorizedException('Refresh token is invalid or expired');
    const account = (await this.pool.query('select id from accounts where owner_id=$1',[userId])).rows[0];
    if (!account) throw new UnauthorizedException();
    return {
      token: jwt.sign({ sub:userId, acc:account.id, sid:sessionId }, secret(), { expiresIn:ACCESS_TOKEN_TTL }),
      refreshToken: rotatedToken,
      expiresAt: expiresAt.toISOString(),
      userId,
    };
  }

  async logout(user: AuthUser) {
    await this.pool.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where id=$1 and user_id=$2',[user.sessionId,user.id]);
    return { success:true };
  }

  async logoutAll(user: AuthUser) {
    await this.pool.query('update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1',[user.id]);
    return { success:true };
  }

  async sessions(user: AuthUser) {
    const r = await this.pool.query(
      'select id,created_at,last_used_at,expires_at from auth_sessions where user_id=$1 and revoked_at is null and expires_at>now() order by created_at desc',
      [user.id],
    );
    return r.rows;
  }

  async revokeSession(user: AuthUser, id: string) {
    const r = await this.pool.query(
      'update auth_sessions set revoked_at=coalesce(revoked_at,now()) where id=$1 and user_id=$2 and revoked_at is null returning id',
      [id,user.id],
    );
    if (!r.rows.length) throw new UnauthorizedException('Session not found or already revoked');
    return { success:true };
  }

  private async findOrCreate(phone: string) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      let r = (await c.query(`select u.id,a.id as acc from users u join accounts a on a.owner_id=u.id where u.phone=$1 for update`,[phone])).rows[0];
      if (!r) {
        await c.query('insert into users(id,phone) values($1,$2) on conflict(phone) do nothing',[randomUUID(),phone]);
        const user=(await c.query('select id from users where phone=$1 for update',[phone])).rows[0];
        if (!user) throw new Error('Unable to create user');
        await c.query('insert into accounts(id,owner_id,kind) values($1,$2,$3) on conflict(owner_id) do nothing',[randomUUID(),user.id,'user']);
        r=(await c.query('select u.id,a.id as acc from users u join accounts a on a.owner_id=u.id where u.phone=$1',[phone])).rows[0];
      }
      if (!r) throw new Error('Unable to create wallet account');
      await c.query('commit');
      return { id:r.id, accountId:r.acc };
    } catch(e) { await c.query('rollback').catch(()=>undefined); throw e; }
    finally { c.release(); }
  }
}
class OtpDto { @IsString() phone: string; }
class VerifyDto { @IsString() phone: string; @IsString() @Matches(/^[0-9]{6}$/) code: string; }
class RefreshDto { @IsString() @MinLength(40) refreshToken: string; }

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('otp') async otp(@Body() b: OtpDto, @Req() req: any) { await this.auth.requestOtp(b.phone, req.ip ?? req.socket?.remoteAddress ?? 'unknown'); return { sent: true }; }
  @Post('verify') verify(@Body() b: VerifyDto, @Req() req: any) { return this.auth.verify(b.phone, b.code, req.ip ?? req.socket?.remoteAddress ?? 'unknown'); }
  @Post('refresh') refresh(@Body() b: RefreshDto) { return this.auth.refresh(b.refreshToken); }
  @Post('logout') @UseGuards(AuthGuard) logout(@CurrentUser() u: AuthUser) { return this.auth.logout(u); }
  @Post('logout-all') @UseGuards(AuthGuard) logoutAll(@CurrentUser() u: AuthUser) { return this.auth.logoutAll(u); }
  @Get('sessions') @UseGuards(AuthGuard) sessions(@CurrentUser() u: AuthUser) { return this.auth.sessions(u); }
  @Delete('sessions/:id') @UseGuards(AuthGuard) revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.auth.revokeSession(u,id); }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, {
    provide: SMS,
    useFactory: (): SmsPort => process.env.NODE_ENV !== 'production'
      ? new ConsoleSms()
      : TwilioSms.isConfigured() ? new TwilioSms() : new UnconfiguredProductionSms(),
  }],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
