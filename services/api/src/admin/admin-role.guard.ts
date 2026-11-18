import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { AuthUser } from '../auth/auth';

const ADMIN_ROLES_METADATA = 'fawran:admin-roles';
export const RequireAdminRoles = (...roles: string[]) => SetMetadata(ADMIN_ROLES_METADATA, roles);

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user?.id) throw new ForbiddenException('Authenticated administrator required');
    const roles = this.reflector.getAllAndOverride<string[]>(ADMIN_ROLES_METADATA, [
      context.getHandler(), context.getClass(),
    ]) ?? ['super_admin'];
    if (!roles.length) throw new ForbiddenException('No administrator roles configured');
    const placeholders = roles.map((_, index) => `$${index + 2}`).join(',');
    const result = await this.pool.query(
      `select role from admin_roles where user_id=$1 and active=true and role in (${placeholders}) limit 1`,
      [user.id, ...roles],
    );
    if (!result.rows[0]) throw new ForbiddenException('Insufficient administrator permissions');
    return true;
  }
}
