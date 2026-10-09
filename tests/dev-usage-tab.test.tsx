/**
 * The Usage tab in Dev (plans #1482 and #1693), drawn from fixtures: spend per
 * function first, then the page opens folded below it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsageScreen } from '@/app/dev/usage/usage-view';
import { functionSpendRows } from '@/lib/usage/function-spend';
import type { PageOpens } from '@/lib/usage/opens';
import { PAGE_ROUTES } from '@/lib/usage/pages';
import { usageReport, type WorkspaceSpend } from '@/lib/usage/report';

const now = new Date('2026-10-02T12:00:00Z');

const opened: PageOpens[] = [
  { route: '/learn', workspace: 'learn', opens7: 4, opens30: 12, lastOpened: '2026-10-02T09:00:00Z' },
  { route: '/learn/s/[id]', workspace: 'learn', opens7: 1, opens30: 3, lastOpened: '2026-10-01T09:00:00Z' },
  { route: '/jobs', workspace: 'jobs', opens7: 0, opens30: 2, lastOpened: '2026-09-20T09:00:00Z' },
  // Opened, but not in the last 30 days.
  { route: '/news', workspace: 'news', opens7: 0, opens30: 0, lastOpened: '2026-08-01T09:00:00Z' },
  { route: '/home', workspace: null, opens7: 6, opens30: 20, lastOpened: '2026-10-02T11:00:00Z' },
];

const spend: WorkspaceSpend[] = [
  { module: 'learn', spend7: 2_000_000, spend30: 8_500_000, calls30: 40, unpriced30: 0 },
  // One module over two rows is summed.
  { module: 'jobs', spend7: 100_000, spend30: 300_000, calls30: 5, unpriced30: 1 },
  { module: 'jobs', spend7: 0, spend30: 200_000, calls30: 2, unpriced30: 0 },
  { module: 'core', spend7: 50_000, spend30: 90_000, calls30: 9, unpriced30: 0 },
];

describe('usageReport', () => {
  const report = usageReport(opened, spend);

  it('lists every page not opened in 30 days, never opened before opened long ago', () => {
    const opened30 = new Set(opened.filter((row) => row.opens30 > 0).map((row) => row.route));
    expect(report.notOpened).toHaveLength(PAGE_ROUTES.length - opened30.size);
    expect(report.notOpened.at(-1)?.route).toBe('/news');
    expect(report.notOpened.every((row) => row.opens30 === 0)).toBe(true);
  });

  it('totals opens per workspace and sets its spend beside them', () => {
    const learn = report.groups.find((group) => group.workspace === 'learn');
    expect(learn).toMatchObject({ opens7: 5, opens30: 15, lastOpened: '2026-10-02T09:00:00Z' });
    expect(learn?.spend?.spend30).toBe(8_500_000);
    expect(learn?.pages.map((page) => page.route)).toEqual(['/learn', '/learn/s/[id]']);

    const jobs = report.groups.find((group) => group.workspace === 'jobs');
    expect(jobs?.spend).toMatchObject({ spend30: 500_000, calls30: 7, unpriced30: 1 });
  });

  it('puts core spend with the pages outside a workspace, last', () => {
    const outside = report.groups.at(-1);
    expect(outside).toMatchObject({ workspace: null, label: 'Outside a workspace', opens30: 20 });
    expect(outside?.spend?.spend30).toBe(90_000);
  });
});

const functions = functionSpendRows([
  { module: 'learn', operation: 'plan-topic', spend_7: 2_000_000, spend_30: 8_500_000, calls_30: 40, unpriced_30: 0 },
  { module: 'core', operation: 'ask-dash', spend_7: 50_000, spend_30: 90_000, calls_30: 9, unpriced_30: 0 },
  { module: 'website', operation: 'odd-job', spend_7: 0, spend_30: 300_000, calls_30: 7, unpriced_30: 1 },
]);

describe('UsageScreen', () => {
  it('opens on the functions, biggest first, with the total above them', () => {
    const html = renderToStaticMarkup(<UsageScreen report={usageReport(opened)} functions={functions} now={now} />);
    const total = html.indexOf('$8.89');
    const first = html.indexOf('Plan topic');
    expect(total).toBeGreaterThan(-1);
    expect(total).toBeLessThan(first);
    expect(first).toBeLessThan(html.indexOf('odd-job'));
    expect(html.indexOf('odd-job')).toBeLessThan(html.indexOf('Ask Dash'));
    expect(html).toContain('$2.00 in 7 days · 40 calls');
    expect(html).toContain('Learn');
    expect(html).toContain('Outside a workspace');
    expect(html).toContain('website · 1 not priced');
    expect(html).toContain('3 functions');
    expect(html).not.toContain('Claude');
  });

  it('folds the page opens below the functions, shut', () => {
    const html = renderToStaticMarkup(<UsageScreen report={usageReport(opened)} functions={functions} now={now} />);
    const fold = html.indexOf('<details');
    expect(fold).toBeGreaterThan(html.indexOf('Ask Dash'));
    expect(html.slice(fold, html.indexOf('>', fold))).not.toContain('open');
    expect(html).toContain('Not opened in 30 days');
    expect(html).toContain('last opened 62 days ago');
    expect(html).toContain('Opens by workspace');
  });

  it('says so when nothing has been spent or opened yet', () => {
    const html = renderToStaticMarkup(<UsageScreen report={usageReport([])} functions={[]} now={now} />);
    expect(html).toContain('No model calls in the last 30 days');
    expect(html).toContain('No page has been opened since recording started');
  });
});
