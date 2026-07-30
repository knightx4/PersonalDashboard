import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  convertAmounts,
  getFxRate,
  type FxRateQuote,
} from '@/lib/fx/rates';
import {
  convertCents,
  isSupportedDisplayCurrency,
  normalizeCurrencyCode,
} from '@/lib/fx/money-fx';
import { formatMoney } from '@/lib/money';

function supabaseFxCache(supabase: SupabaseClient) {
  return {
    async getCached(
      rateDate: string,
      from: string,
      to: string,
    ): Promise<FxRateQuote | null> {
      const { data } = await supabase
        .from('fx_rates')
        .select('rate, rate_date, source, base_currency, quote_currency')
        .eq('rate_date', rateDate)
        .eq('base_currency', from)
        .eq('quote_currency', to)
        .maybeSingle();
      if (!data) return null;
      return {
        rate: Number(data.rate),
        rateDate: data.rate_date as string,
        source: (data.source as string) ?? 'frankfurter',
        from: data.base_currency as string,
        to: data.quote_currency as string,
      };
    },
    async putCached(quote: FxRateQuote): Promise<void> {
      await supabase.from('fx_rates').upsert(
        {
          rate_date: quote.rateDate,
          base_currency: quote.from,
          quote_currency: quote.to,
          rate: quote.rate,
          source: quote.source,
        },
        { onConflict: 'rate_date,base_currency,quote_currency' },
      );
    },
  };
}

export async function loadDisplayCurrency(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('display_currency')
    .eq('id', userId)
    .maybeSingle();
  const code = normalizeCurrencyCode(data?.display_currency);
  return isSupportedDisplayCurrency(code) ? code : 'USD';
}

export async function convertToDisplayCents(
  supabase: SupabaseClient,
  amounts: ReadonlyArray<{ cents: number; currency: string; date: string }>,
  displayCurrency: string,
): Promise<number[]> {
  return convertAmounts(amounts, displayCurrency, supabaseFxCache(supabase));
}

export async function convertOneToDisplay(
  supabase: SupabaseClient,
  amount: { cents: number; currency: string; date: string },
  displayCurrency: string,
): Promise<{ displayCents: number; rate: FxRateQuote }> {
  const from = normalizeCurrencyCode(amount.currency);
  const to = normalizeCurrencyCode(displayCurrency);
  const rate = await getFxRate(
    { from, to, date: amount.date },
    supabaseFxCache(supabase),
  );
  return {
    displayCents: convertCents(amount.cents, rate.rate),
    rate,
  };
}

export function formatMoneyPair(opts: {
  nativeCents: number;
  nativeCurrency: string;
  displayCents: number;
  displayCurrency: string;
}): { primary: string; secondary?: string } {
  const primary = formatMoney(opts.displayCents, opts.displayCurrency);
  if (
    normalizeCurrencyCode(opts.nativeCurrency) ===
    normalizeCurrencyCode(opts.displayCurrency)
  ) {
    return { primary };
  }
  return {
    primary,
    secondary: formatMoney(opts.nativeCents, opts.nativeCurrency),
  };
}
