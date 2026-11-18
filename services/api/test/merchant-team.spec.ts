import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MerchantService } from '../src/merchants/merchants.module';

function serviceWith(actorRole: string, targetRole: string | null) {
  const poolQuery = jest.fn(async (sql: string) => {
    if (sql.includes('join merchant_members')) return { rows: [{ id: 'merchant-1', role: actorRole }] };
    return { rows: [] };
  });
  let roleReadCount = 0;
  const clientQuery = jest.fn(async (sql: string) => {
    if (sql.includes('select role from merchant_members') && sql.includes('user_id=$2')) {
      roleReadCount += 1;
      const role = roleReadCount === 1 ? actorRole : targetRole;
      return { rows: [{ role }].filter(x => x.role !== null) };
    }
    return { rows: [] };
  });
  const client = { query: clientQuery, release: jest.fn() };
  const pool = { query: poolQuery, connect: jest.fn(async () => client) };
  return { service: new MerchantService(pool as any, {} as any), poolQuery, clientQuery, client };
}

describe('merchant team role management', () => {
  it('allows the owner to promote a member to admin', async () => {
    const h = serviceWith('owner', 'manager');
    const result = await h.service.updateMemberRole('owner-user', 'merchant-1', 'member-user', { role: 'admin' } as any);
    expect(result).toEqual({ merchantId: 'merchant-1', userId: 'member-user', role: 'admin' });
    expect(h.clientQuery).toHaveBeenCalledWith(
      'update merchant_members set role=$3 where merchant_id=$1 and user_id=$2',
      ['merchant-1', 'member-user', 'admin'],
    );
    expect(h.clientQuery).toHaveBeenCalledWith('commit');
    expect(h.client.release).toHaveBeenCalled();
  });

  it('prevents admins from assigning admin access', async () => {
    const h = serviceWith('admin', 'manager');
    await expect(h.service.updateMemberRole('admin-user', 'merchant-1', 'member-user', { role: 'admin' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.poolQuery).toHaveBeenCalled();
  });

  it('prevents changing the owner role', async () => {
    const h = serviceWith('owner', 'owner');
    await expect(h.service.updateMemberRole('owner-user', 'merchant-1', 'member-user', { role: 'viewer' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents self role changes and self removal', async () => {
    const h = serviceWith('owner', 'manager');
    await expect(h.service.updateMemberRole('owner-user', 'merchant-1', 'owner-user', { role: 'viewer' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.removeMember('owner-user', 'merchant-1', 'owner-user'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents an admin from removing another admin', async () => {
    const h = serviceWith('admin', 'admin');
    await expect(h.service.removeMember('admin-user', 'merchant-1', 'other-admin'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found for a member outside the merchant', async () => {
    const h = serviceWith('owner', null);
    await expect(h.service.removeMember('owner-user', 'merchant-1', 'missing-user'))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
