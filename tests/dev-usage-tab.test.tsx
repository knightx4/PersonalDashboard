/**
 * The Usage tab in Dev (plan #1482), drawn from a fixture of page views: opens
 * and spend per page and workspace, the pages not opened in 30 days first.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsageScreen } from '@/app/dev/usage/usage-view';
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

describe('UsageScreen', () => {
  it('draws the unopened pages first, then opens and spend per workspace', () => {
    const html = renderToStaticMarkup(<UsageScreen report={usageReport(opened, spend)} now={now} />);
    const notOpened = html.indexOf('Not opened in 30 days');
    expect(notOpened).toBeGreaterThan(-1);
    expect(notOpened).toBeLessThan(html.indexOf('>Learn<'));
    expect(html).toContain('last opened 62 days ago');
    expect(html).toContain('$8.50 spent in 30 days ($2.00 in 7) over 40 calls');
    expect(html).toContain('7 calls, 1 not priced');
    expect(html).toContain('last opened today');
    expect(html).not.toContain('Claude');
  });

  it('says nothing has been opened yet before the first view lands', () => {
    const html = renderToStaticMarkup(<UsageScreen report={usageReport([], [])} now={now} />);
    expect(html).toContain('No page has been opened since recording started');
  });
});
