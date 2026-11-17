import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { AuthUser } from '../auth/auth';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user?.id) throw new ForbiddenException('Authenticated administrator required');
    const result = await this.pool.query(
      'select role from admin_roles where user_id=$1 and active=true and role in ('super_admin','compliance_admin') limit 1',
      [user.id],
    );
    if (!result.rows[0]) throw new ForbiddenException('Administrator access required');
    return true;
  }
}
