/**
 * Country and currency metadata for Fawran's multi-market architecture.
 *
 * This registry is configuration, not a payment-rail integration or market
 * launch approval. Real-money movement remains unavailable in every market.
 * Currency minor units are explicit; do not assume every future currency has
 * two decimal places.
 */
export interface MarketProfile {
  countryCode: string;
  countryName: string;
  currency: string;
  currencyMinorUnit: number;
  defaultLocale: string;
  supportedLocales: readonly string[];
  timeZone: string;
  launchStage: 'planned';
  productionPaymentsEnabled: false;
}

const MARKET_PROFILES: readonly MarketProfile[] = [
  {
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    currency: 'AED',
    currencyMinorUnit: 2,
    defaultLocale: 'en-AE',
    supportedLocales: ['en-AE', 'ar-AE'],
    timeZone: 'Asia/Dubai',
    launchStage: 'planned',
    productionPaymentsEnabled: false,
  },
  {
    countryCode: 'EG',
    countryName: 'Egypt',
    currency: 'EGP',
    currencyMinorUnit: 2,
    defaultLocale: 'ar-EG',
    supportedLocales: ['ar-EG', 'en-EG'],
    timeZone: 'Africa/Cairo',
    launchStage: 'planned',
    productionPaymentsEnabled: false,
  },
  {
    countryCode: 'SA',
    countryName: 'Saudi Arabia',
    currency: 'SAR',
    currencyMinorUnit: 2,
    defaultLocale: 'ar-SA',
    supportedLocales: ['ar-SA', 'en-SA'],
    timeZone: 'Asia/Riyadh',
    launchStage: 'planned',
    productionPaymentsEnabled: false,
  },
  {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    currency: 'GBP',
    currencyMinorUnit: 2,
    defaultLocale: 'en-GB',
    supportedLocales: ['en-GB'],
    timeZone: 'Europe/London',
    launchStage: 'planned',
    productionPaymentsEnabled: false,
  },
  {
    countryCode: 'US',
    countryName: 'United States',
    currency: 'USD',
    currencyMinorUnit: 2,
    defaultLocale: 'en-US',
    supportedLocales: ['en-US'],
    timeZone: 'America/New_York',
    launchStage: 'planned',
    productionPaymentsEnabled: false,
  },
] as const;

const BY_COUNTRY = new Map(MARKET_PROFILES.map((market) => [market.countryCode, market]));

/** Return a defensive copy so callers cannot mutate the shared market catalog. */
export function listMarketProfiles(): MarketProfile[] {
  return MARKET_PROFILES.map((market) => ({
    ...market,
    supportedLocales: [...market.supportedLocales],
  }));
}

export function getMarketProfile(countryCode: string): MarketProfile | null {
  const market = BY_COUNTRY.get(countryCode.trim().toUpperCase());
  if (!market) return null;
  return { ...market, supportedLocales: [...market.supportedLocales] };
}

/** Convert a decimal major-unit amount to integer minor units without floats. */
export function toMinorUnits(amount: string, minorUnit: number): bigint {
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) {
    throw new Error('Currency minor unit must be an integer between 0 and 6');
  }
  const normalized = amount.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error('Amount must be a positive decimal string');
  const fraction = match[2] ?? '';
  if (fraction.length > minorUnit) {
    throw new Error('Amount has more decimal places than the currency allows');
  }
  const scale = 10n ** BigInt(minorUnit);
  const whole = BigInt(match[1]);
  const fractional = BigInt((fraction + '0'.repeat(minorUnit)).slice(0, minorUnit) || '0');
  const result = whole * scale + fractional;
  if (result <= 0n) throw new Error('Amount must be greater than zero');
  return result;
}

/**
 * Intentionally hard-coded false. A market cannot be activated by setting an
 * environment variable; activation requires a reviewed code change after
 * partner, regulatory, compliance, security and operations sign-off.
 */
export function canMoveRealMoney(_countryCode: string): false {
  return false;
}
