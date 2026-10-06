/**
 * The path above a page (plan #1622): every part a link, the last marked as
 * the page you are on, the parts above the parent folded to an ellipsis on a
 * phone.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumb } from '@/components/shell/breadcrumb';
import { PageHeader } from '@/components/shell/page-header';

const crumbs = [
  { label: 'Goals', href: '/goals' },
  { label: 'Family', href: '/goals/area/a1' },
  { label: "Sam's birthday", href: '/goals/g1' },
  { label: 'Buy a cake', href: '/goals/g1/s/cake' },
];

describe('Breadcrumb', () => {
  it('links every part and marks the last as this page', () => {
    const html = renderToStaticMarkup(<Breadcrumb crumbs={crumbs} />);
    for (const crumb of crumbs) expect(html).toContain(`href="${crumb.href}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*href="\/goals\/g1\/s\/cake"/);
  });

  it('folds the parts above the parent into one ellipsis on a phone', () => {
    const html = renderToStaticMarkup(<Breadcrumb crumbs={crumbs} />);
    // Only Family folds: Goals, the parent and the page stay.
    expect(html.match(/max-sm:hidden/g)).toHaveLength(1);
    expect(html).toMatch(/max-sm:hidden[^"]*"><span[^>]*>›<\/span><a[^>]*href="\/goals\/area\/a1"/);
    expect(html.match(/…/g)).toHaveLength(1);
    // Three parts have nothing between the first and the parent to fold.
    expect(renderToStaticMarkup(<Breadcrumb crumbs={crumbs.slice(0, 3)} />)).not.toContain('…');
  });

  it('draws nothing for an empty path', () => {
    expect(renderToStaticMarkup(<Breadcrumb crumbs={[]} />)).toBe('');
  });

  it('sits above the heading in PageHeader, which is unchanged without one', () => {
    const plain = renderToStaticMarkup(<PageHeader title="All goals" />);
    expect(plain).not.toContain('Breadcrumb');
    expect(plain).toMatch(/^<div class="[^"]*\bmb-5\b[^"]*">/);
    const html = renderToStaticMarkup(<PageHeader title="All goals" crumbs={crumbs.slice(0, 2)} />);
    expect(html.indexOf('aria-label="Breadcrumb"')).toBeLessThan(html.indexOf('<h1'));
  });
});
