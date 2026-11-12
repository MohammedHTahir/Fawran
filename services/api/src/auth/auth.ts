import { BadRequestException, CanActivate, ExecutionContext, Inject, Injectable, Module, UnauthorizedException,
  Body, Controller, Post, createParamDecorator } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
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

export interface AuthUser { id: string; accountId: string; }
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers['authorization'] ?? '';
    try {
      const p: any = jwt.verify(h.replace(/^Bearer /, ''), secret());
      req.user = { id: p.sub, accountId: p.acc } as AuthUser;
      return true;
    } catch { throw new UnauthorizedException(); }
  }
}

@Injectable()
export class AuthService {
  // Development-only process memory. Production requires a shared OTP store
  // (Redis/DB) before scaling to multiple API instances.
  private otps = new Map<string, { digest: string; exp: number; tries: number; sentAt: number; windowStart: number; sends: number }>();
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(SMS) private sms: SmsPort) {}

  async requestOtp(phoneRaw: string) {
    const phone = normalizePhone(phoneRaw);
    const now = Date.now();
    const prior = this.otps.get(phone);
    const windowStart = prior && now - prior.windowStart < 15 * 60_000 ? prior.windowStart : now;
    const sends = prior && windowStart === prior.windowStart ? prior.sends : 0;
    if (prior && now - prior.sentAt < 60_000) throw new BadRequestException('Please wait before requesting another code');
    if (sends >= 3) throw new BadRequestException('Too many OTP requests; try again later');
    const code = process.env.NODE_ENV === 'production' ? String(randomInt(100000, 1000000)) : '000000';
    const digest = createHash('sha256').update(`${phone}:${code}`).digest('hex');
    await this.sms.send(phone, `Your Fawran code: ${code}`);
    this.otps.set(phone, { digest, exp: now + 5 * 60_000, tries: 0, sentAt: now, windowStart, sends: sends + 1 });
  }

  async verify(phoneRaw: string, code: string) {
    const phone = normalizePhone(phoneRaw);
    const o = this.otps.get(phone);
    if (!o || o.exp < Date.now() || o.tries >= 5) throw new UnauthorizedException('Code expired, request a new one');
    o.tries++;
    const supplied = createHash('sha256').update(`${phone}:${code}`).digest();
    const expected = Buffer.from(o.digest, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException('Wrong code');
    }
    this.otps.delete(phone);
    const { id, accountId } = await this.findOrCreate(phone);
    return { token: jwt.sign({ sub: id, acc: accountId }, secret(), { expiresIn: '1h' }), userId: id };
  }

  private async findOrCreate(phone: string) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      let r = (await c.query(
        `select u.id, a.id as acc from users u join accounts a on a.owner_id = u.id where u.phone=$1 for update`, [phone])).rows[0];
      if (!r) {
        const candidateId = randomUUID();
        await c.query('insert into users (id, phone) values ($1,$2) on conflict (phone) do nothing', [candidateId, phone]);
        const user = (await c.query('select id from users where phone=$1 for update', [phone])).rows[0];
        if (!user) throw new Error('Unable to create user');
        await c.query(
          'insert into accounts (id, owner_id, kind) values ($1,$2,$3) on conflict (owner_id) do nothing',
          [randomUUID(), user.id, 'user']);
        r = (await c.query(
          `select u.id, a.id as acc from users u join accounts a on a.owner_id = u.id where u.phone=$1`, [phone])).rows[0];
      }
      if (!r) throw new Error('Unable to create wallet account');
      await c.query('commit');
      return { id: r.id, accountId: r.acc };
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally { c.release(); }
  }
}

class OtpDto { @IsString() phone: string; }
class VerifyDto { @IsString() phone: string; @IsString() code: string; }

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Post('otp') async otp(@Body() b: OtpDto) { await this.auth.requestOtp(b.phone); return { sent: true }; }
  @Post('verify') verify(@Body() b: VerifyDto) { return this.auth.verify(b.phone, b.code); }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, {
    provide: SMS,
    useFactory: (): SmsPort => process.env.NODE_ENV === 'production'
      ? new UnconfiguredProductionSms()
      : new ConsoleSms(),
  }],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
