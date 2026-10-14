import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpendOverview } from '@/app/account/spend/spend-overview';
import { fillDays, spendTotal } from '@/lib/usage/per-day';

/** The Account Spend page's top (plan #2036.3): the chart and the totals agree. */
describe('SpendOverview', () => {
  const values = fillDays(
    [
      { day: '2026-10-13', value: 500_000 },
      { day: '2026-10-14', value: 250_000 },
    ],
    '2026-10-14',
    30,
  );
  const last30 = spendTotal({ values, calls: 3, unpriced: 0 });
  const one = { calls: 3, micros: 750_000, unpriced: 0 };

  it('draws a bar for each of the thirty days and lists the amount they add up to', () => {
    const html = renderToStaticMarkup(
      <SpendOverview values={values} today="2026-10-14" span={30} last30={last30} thisMonth={one} allTime={one} />,
    );
    expect(html).toContain('Model spend');
    expect(html).toContain('Last 30 days');
    expect(last30.micros).toBe(values.reduce((sum, day) => sum + day.value, 0));
    expect(html).toContain('$0.75');
  });
});
