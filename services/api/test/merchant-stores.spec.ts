import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MerchantService } from '../src/merchants/merchants.module';

function makeService(role: string, storeRows: unknown[] = []) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('join merchant_members')) return { rows: [{ id: 'merchant-1', role }] };
    if (sql.includes('returning id as "storeId"')) return { rows: storeRows };
    return { rows: [] };
  });
  const pool = { query, connect: jest.fn() };
  return { service: new MerchantService(pool as any, {} as any), query };
}

describe('merchant stores', () => {
  it('allows a merchant manager to create a draft store in a supported market', async () => {
    const h = makeService('manager');
    const result = await h.service.createStore('manager-1', 'merchant-1', {
      name: 'Downtown branch', countryCode: 'AE', address: 'Dubai Marina',
    } as any);
    expect(result).toMatchObject({
      merchantId: 'merchant-1', name: 'Downtown branch', countryCode: 'AE',
      address: 'Dubai Marina', status: 'draft',
    });
    expect(h.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into merchant_stores'),
      expect.arrayContaining(['merchant-1', 'Downtown branch', 'AE', 'Dubai Marina']),
    );
  });

  it('does not allow a viewer to create a store', async () => {
    const h = makeService('viewer');
    await expect(h.service.createStore('viewer-1', 'merchant-1', {
      name: 'Branch', countryCode: 'AE',
    } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('rejects store countries outside the supported market catalog', async () => {
    const h = makeService('owner');
    await expect(h.service.createStore('owner-1', 'merchant-1', {
      name: 'Branch', countryCode: 'ZZ',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a manager to edit store details but not activate a store', async () => {
    const h = makeService('manager');
    await expect(h.service.updateStore('manager-1', 'merchant-1', 'store-1', { status: 'active' } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('returns not found when updating a store outside the merchant', async () => {
    const h = makeService('owner', []);
    await expect(h.service.updateStore('owner-1', 'merchant-1', 'missing', { name: 'Updated' } as any))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
