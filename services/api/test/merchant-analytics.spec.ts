import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MerchantService } from '../src/merchants/merchants.module';

function makeService(role: string, analyticsRows: unknown[] = []) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('join merchant_members')) {
      if (role === 'none') return { rows: [] };
      return { rows: [{ id: 'merchant-1', role }] };
    }
    if (sql.includes('from payment_links')) return { rows: analyticsRows };
    return { rows: [] };
  });
  return { service: new MerchantService({ query } as any, {} as any), query };
}

describe('merchant analytics', () => {
  it('returns separate per-currency paid volumes and conversion without combining currencies', async () => {
    const h = makeService('viewer', [
      { currency: 'AED', link_count: 4, paid_count: 2, paid_volume_minor: '12500', open_count: 1, inactive_count: 1 },
      { currency: 'EGP', link_count: 3, paid_count: 1, paid_volume_minor: '7000', open_count: 2, inactive_count: 0 },
    ]);
    const result = await h.service.analytics('viewer-1', 'merchant-1', '2026-11-01', '2026-11-19');
    expect(result).toMatchObject({
      merchantId: 'merchant-1',
      period: { from: '2026-11-01', to: '2026-11-19', basis: 'payment_link_created_at' },
      totals: { linkCount: 7, paidCount: 3, openCount: 3, inactiveCount: 1 },
      currencies: [
        { currency: 'AED', paidVolumeMinor: 12500, conversionBps: 5000 },
        { currency: 'EGP', paidVolumeMinor: 7000, conversionBps: 3333 },
      ],
    });
    expect(h.query).toHaveBeenCalledWith(expect.stringContaining('group by currency'), [
      'merchant-1', '2026-11-01', '2026-11-19',
    ]);
  });

  it('allows a viewer to read analytics but rejects users outside the merchant', async () => {
    const h = makeService('none');
    await expect(h.service.analytics('outsider', 'merchant-1')).rejects.toBeInstanceOf(
      (await import('@nestjs/common')).NotFoundException,
    );
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid calendar dates before querying analytics', async () => {
    const h = makeService('owner');
    await expect(h.service.analytics('owner-1', 'merchant-1', '2026-02-30', '2026-03-01'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('rejects reversed date ranges', async () => {
    const h = makeService('owner');
    await expect(h.service.analytics('owner-1', 'merchant-1', '2026-11-20', '2026-11-19'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('returns zero totals when no payment links exist in the period', async () => {
    const h = makeService('owner');
    const result = await h.service.analytics('owner-1', 'merchant-1', '2026-11-01', '2026-11-19');
    expect(result.totals).toEqual({ linkCount: 0, paidCount: 0, openCount: 0, inactiveCount: 0 });
    expect(result.currencies).toEqual([]);
  });
});
