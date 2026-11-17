import {
  canMoveRealMoney,
  getMarketProfile,
  getMarketByCurrency,
  listMarketProfiles,
  toMinorUnits,
} from '../src/markets/market-registry';

describe('multi-market registry', () => {
  it('defines the initial multi-market country catalog', () => {
    expect(listMarketProfiles().map((market) => market.countryCode))
      .toEqual(['AE', 'EG', 'SA', 'GB', 'US']);
  });

  it('normalizes country codes and returns isolated profile data', () => {
    const profile = getMarketProfile(' ae ');
    expect(profile?.currency).toBe('AED');
    expect(profile?.supportedLocales).not.toBe(getMarketProfile('AE')?.supportedLocales);
    expect(getMarketProfile('AE')?.supportedLocales).toEqual(['en-AE', 'ar-AE']);
  });

  it('resolves a market by currency without enabling the market', () => {
    expect(getMarketByCurrency('aed')?.countryCode).toBe('AE');
    expect(getMarketByCurrency('ZZZ')).toBeNull();
  });

  it('returns null for markets not in the reviewed catalog', () => {
    expect(getMarketProfile('ZZ')).toBeNull();
  });

  it('keeps production payments disabled in every market', () => {
    for (const market of listMarketProfiles()) {
      expect(market.productionPaymentsEnabled).toBe(false);
      expect(canMoveRealMoney(market.countryCode)).toBe(false);
    }
  });
});

describe('currency minor-unit conversion', () => {
  it('converts decimal strings to integer minor units without floating point', () => {
    expect(toMinorUnits('123.45', 2)).toBe(12345n);
    expect(toMinorUnits('100', 2)).toBe(10000n);
    expect(toMinorUnits('7', 0)).toBe(7n);
    expect(toMinorUnits('1.234', 3)).toBe(1234n);
  });

  it('rejects precision loss and invalid amounts', () => {
    expect(() => toMinorUnits('1.001', 2)).toThrow();
    expect(() => toMinorUnits('-1.00', 2)).toThrow();
    expect(() => toMinorUnits('0', 2)).toThrow();
  });
});
