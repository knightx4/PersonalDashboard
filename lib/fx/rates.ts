import {
  convertCents,
  fxCacheKey,
  normalizeCurrencyCode,
} from '@/lib/fx/money-fx';

const FRANKFURTER_BASE = 'https://api.frankfurter.app';

export type FxRateQuote = {
  rate: number;
  rateDate: string;
  source: string;
  from: string;
  to: string;
};

type FrankfurterResponse = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};

async function fetchFrankfurter(
  date: string,
  from: string,
  to: string[],
): Promise<FrankfurterResponse> {
  const quotes = to.map((c) => normalizeCurrencyCode(c)).join(',');
  const url = `${FRANKFURTER_BASE}/${date}?from=${normalizeCurrencyCode(from)}&to=${quotes}`;
  const res = await fetch(url, { next: { revalidate: 86_400 } });
  if (!res.ok) {
    throw new Error(`Frankfurter ${res.status} for ${url}`);
  }
  return (await res.json()) as FrankfurterResponse;
}

type RateCache = {
  getCached: (
    rateDate: string,
    from: string,
    to: string,
  ) => Promise<FxRateQuote | null>;
  putCached: (quote: FxRateQuote) => Promise<void>;
};

/** In-memory fallback when DB cache is unavailable (tests / first hit). */
const memory = new Map<string, FxRateQuote>();

export function memoryFxCache(): RateCache {
  return {
    async getCached(rateDate, from, to) {
      return memory.get(fxCacheKey(rateDate, from, to)) ?? null;
    },
    async putCached(quote) {
      memory.set(fxCacheKey(quote.rateDate, quote.from, quote.to), quote);
    },
  };
}

export function clearMemoryFxCache(): void {
  memory.clear();
}

/**
 * Resolve quote_currency units per 1 base unit on (or nearest to) rateDate.
 * Prefer a provided cache (Supabase fx_rates); otherwise memory + Frankfurter.
 */
export async function getFxRate(
  input: { from: string; to: string; date: string },
  cache: RateCache = memoryFxCache(),
): Promise<FxRateQuote> {
  const from = normalizeCurrencyCode(input.from);
  const to = normalizeCurrencyCode(input.to);
  const date = input.date.slice(0, 10);

  if (from === to) {
    return { rate: 1, rateDate: date, source: 'identity', from, to };
  }

  const cached = await cache.getCached(date, from, to);
  if (cached) return cached;

  const payload = await fetchFrankfurter(date, from, [to]);
  const rate = payload.rates[to];
  if (!(rate > 0)) {
    throw new Error(`Frankfurter missing rate ${from}→${to} on ${date}`);
  }

  // Cache under the requested date so re-lookups hit even when Frankfurter
  // snaps weekends/holidays to the previous publishing day.
  const quote: FxRateQuote = {
    rate,
    rateDate: date,
    source: 'frankfurter',
    from,
    to,
  };
  await cache.putCached(quote);
  return quote;
}

/** Convert many amounts, batching Frankfurter calls by (date, from). */
export async function convertAmounts(
  amounts: ReadonlyArray<{ cents: number; currency: string; date: string }>,
  displayCurrency: string,
  cache: RateCache = memoryFxCache(),
): Promise<number[]> {
  const display = normalizeCurrencyCode(displayCurrency);
  const needed = new Map<string, { date: string; from: string; to: string }>();

  for (const amount of amounts) {
    const from = normalizeCurrencyCode(amount.currency);
    if (from === display) continue;
    const date = amount.date.slice(0, 10);
    needed.set(fxCacheKey(date, from, display), { date, from, to: display });
  }

  const rates = new Map<string, number>();
  const byDateFrom = new Map<string, { date: string; from: string; tos: Set<string> }>();
  for (const req of needed.values()) {
    const groupKey = `${req.date}|${req.from}`;
    const group = byDateFrom.get(groupKey) ?? {
      date: req.date,
      from: req.from,
      tos: new Set<string>(),
    };
    group.tos.add(req.to);
    byDateFrom.set(groupKey, group);
  }

  for (const group of byDateFrom.values()) {
    const missing: string[] = [];
    for (const to of group.tos) {
      const cached = await cache.getCached(group.date, group.from, to);
      if (cached) {
        rates.set(fxCacheKey(group.date, group.from, to), cached.rate);
      } else {
        missing.push(to);
      }
    }
    if (missing.length === 0) continue;

    const payload = await fetchFrankfurter(group.date, group.from, missing);
    for (const to of missing) {
      const rate = payload.rates[to];
      if (!(rate > 0)) {
        throw new Error(
          `Frankfurter missing rate ${group.from}→${to} on ${group.date}`,
        );
      }
      const quote: FxRateQuote = {
        rate,
        rateDate: group.date,
        source: 'frankfurter',
        from: group.from,
        to,
      };
      await cache.putCached(quote);
      rates.set(fxCacheKey(group.date, group.from, to), rate);
    }
  }

  return amounts.map((amount) => {
    const from = normalizeCurrencyCode(amount.currency);
    if (from === display) return amount.cents;
    const key = fxCacheKey(amount.date.slice(0, 10), from, display);
    const rate = rates.get(key);
    if (rate == null) {
      throw new Error(`Missing FX rate for ${key}`);
    }
    return convertCents(amount.cents, rate);
  });
}

export { convertCents };
