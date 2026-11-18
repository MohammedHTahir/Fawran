import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MerchantService } from '../src/merchants/merchants.module';

function makeService(options: {
  actorRole?: string;
  inviteeId?: string | null;
  invitation?: Record<string, unknown> | null;
  memberExists?: boolean;
  expiresAt?: string;
} = {}) {
  const actorRole = options.actorRole ?? 'owner';
  const poolQuery = jest.fn(async (sql: string) => {
    if (sql.includes('join merchant_members')) return { rows: [{ id: 'merchant-1', role: actorRole }] };
    if (sql.includes('select id from users where phone')) return { rows: options.inviteeId === null ? [] : [{ id: options.inviteeId ?? 'invitee-1' }] };
    return { rows: [] };
  });
  const clientQuery = jest.fn(async (sql: string) => {
    if (sql.includes('select role from merchant_members')) return { rows: [{ role: actorRole }] };
    if (sql.includes('select 1 from merchant_members')) return { rows: options.memberExists ? [{ '?column?': 1 }] : [] };
    if (sql.includes('select * from merchant_invitations')) {
      return { rows: options.invitation ? [{
        id: 'invite-1', merchant_id: 'merchant-1', invited_user_id: 'invitee-1',
        role: 'manager', status: 'pending', expires_at: options.expiresAt ?? '2099-01-01T00:00:00.000Z',
        ...options.invitation,
      }] : [] };
    }
    return { rows: [] };
  });
  const client = { query: clientQuery, release: jest.fn() };
  const pool = { query: poolQuery, connect: jest.fn(async () => client) };
  return { service: new MerchantService(pool as any, {} as any), poolQuery, clientQuery, client };
}

describe('merchant invitations', () => {
  it('allows an owner to invite a registered user with a merchant role', async () => {
    const h = makeService();
    const result = await h.service.createInvitation('owner-1', 'merchant-1', {
      phone: '+201001234567', role: 'manager',
    } as any);
    expect(result).toMatchObject({
      merchantId: 'merchant-1', invitedUserId: 'invitee-1', role: 'manager',
      status: 'pending', expiresInDays: 7,
    });
    expect(h.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('insert into merchant_invitations'),
      expect.arrayContaining(['merchant-1', 'invitee-1', 'owner-1', 'manager']),
    );
    expect(h.clientQuery).toHaveBeenCalledWith('commit');
  });

  it('does not allow a merchant admin to invite another admin', async () => {
    const h = makeService({ actorRole: 'admin' });
    await expect(h.service.createInvitation('admin-1', 'merchant-1', {
      phone: '+201001234567', role: 'admin',
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clientQuery).not.toHaveBeenCalled();
  });

  it('requires the invitee to have an account', async () => {
    const h = makeService({ inviteeId: null });
    await expect(h.service.createInvitation('owner-1', 'merchant-1', {
      phone: '+201001234567', role: 'viewer',
    } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not create an invitation for an existing merchant member', async () => {
    const h = makeService({ memberExists: true });
    await expect(h.service.createInvitation('owner-1', 'merchant-1', {
      phone: '+201001234567', role: 'viewer',
    } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(h.clientQuery).toHaveBeenCalledWith('rollback');
  });

  it('only lets the invited user accept the invitation', async () => {
    const h = makeService({ invitation: { invited_user_id: 'someone-else' } });
    await expect(h.service.acceptInvitation('wrong-user', 'invite-1'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds the invited user to the merchant and marks the invitation accepted', async () => {
    const h = makeService({ invitation: { invited_user_id: 'invitee-1' } });
    const result = await h.service.acceptInvitation('invitee-1', 'invite-1');
    expect(result).toEqual({ invitationId: 'invite-1', accepted: true });
    expect(h.clientQuery).toHaveBeenCalledWith(
      'insert into merchant_members(merchant_id,user_id,role) values($1,$2,$3)',
      ['merchant-1', 'invitee-1', 'manager'],
    );
    expect(h.clientQuery).toHaveBeenCalledWith('commit');
  });

  it('rejects an expired invitation', async () => {
    const h = makeService({
      invitation: { invited_user_id: 'invitee-1' },
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    await expect(h.service.acceptInvitation('invitee-1', 'invite-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.clientQuery).toHaveBeenCalledWith(
      "update merchant_invitations set status='expired',updated_at=now() where id=$1",
      ['invite-1'],
    );
    expect(h.clientQuery).toHaveBeenCalledWith('commit');
  });
});
