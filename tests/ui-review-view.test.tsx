/**
 * The review page, rendered.
 *
 * Two things about it are easy to get wrong and invisible to a test on the
 * loader: a module nobody has reviewed must read as never reviewed rather than
 * as clean, and a page with nothing recorded must not draw an empty section or
 * a count of zero. Both are claims about markup, so they are checked in
 * markup.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UiReview } from '@/lib/ui-review/load';

// The server actions pull in the session client, which has no business in a
// render test; the view only needs them to exist to hand to its forms.
vi.mock('@/app/dev/ui/review/actions', () => {
  const noop = async () => ({});
  return { decideUiFinding: noop, startUiReview: noop };
});

const { ReviewView } = await import('@/app/dev/ui/review/review-view');

const reviewed: UiReview = {
  id: 'r1',
  scope: 'vault',
  commitSha: 'abc1234',
  violations: 0,
  note: 'Left the settings page alone; it is mid-rewrite.',
  createdAt: '2026-09-09T09:00:00.000Z',
  findings: [
    {
      id: 'f1',
      file: 'app/vault/page.tsx',
      line: 101,
      law: '11',
      surface: 'vault-note',
      body: 'The folder heading is a frame around a frame.',
      status: 'open',
      note: null,
      createdAt: '2026-09-09T09:01:00.000Z',
      decidedAt: null,
    },
  ],
};

describe('the review page', () => {
  it('says never reviewed rather than showing nothing', () => {
    const html = renderToStaticMarkup(
      <ReviewView
        standings={[
          { scope: 'learn', label: 'Learn', violations: 0, surfaces: 1, lastReview: null },
        ]}
        only={null}
      />,
    );

    expect(html).toContain('Never reviewed');
    expect(html).not.toContain('Reviewed 2026');
  });

  it('draws no findings section and no zero when nothing is recorded', () => {
    const html = renderToStaticMarkup(
      <ReviewView
        standings={[
          { scope: 'todo', label: 'Todo', violations: 0, surfaces: 0, lastReview: null },
        ]}
        only={null}
      />,
    );

    expect(html).not.toContain('To decide');
    expect(html).not.toContain('0 findings');
    expect(html).not.toContain('0 surfaces');
    expect(html).not.toContain('0 mechanical');
    // A module with nothing in the gallery says so rather than saying nothing.
    expect(html).toContain('Nothing to look at yet');
  });

  it('shows the last pass, its note and what it is still waiting on', () => {
    const html = renderToStaticMarkup(
      <ReviewView
        standings={[
          { scope: 'vault', label: 'Vault', violations: 2, surfaces: 1, lastReview: reviewed },
        ]}
        only="vault"
      />,
    );

    expect(html).toContain('Reviewed 2026-09-09');
    expect(html).toContain('2 mechanical violations');
    expect(html).toContain('Left the settings page alone');
    expect(html).toContain('To decide');
    expect(html).toContain('app/vault/page.tsx:101');
    expect(html).toContain('/preview?s=vault-note');
  });
});
