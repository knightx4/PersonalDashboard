/**
 * The recommended newsletters view as it first renders (plan #947).
 *
 * What a server render can pin is what the page shows from the stored list:
 * the picks under their topics, each linking to its sign-up page, and the
 * Reload button. The run itself (replacing the list, and leaving it alone on
 * a failure) is pinned in lib/news/recommend/make.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NewsletterPick } from '@/lib/news/recommend/picks';

vi.mock('@/app/news/all/actions', () => ({
  remakeRecommendations: async () => ({ status: 'idle' }),
}));

const { RecommendedNewsletters } = await import('@/app/news/all/recommended');

const picks: NewsletterPick[] = [
  {
    name: 'Import AI',
    publisher: 'Jack Clark',
    topic: 'Technology',
    reason: 'Weekly notes on machine learning research.',
    link: 'https://importai.substack.com/',
  },
  {
    name: 'The Rundown',
    publisher: 'The Rundown',
    topic: 'Business',
    reason: 'A short daily on markets.',
    link: 'https://example.com/rundown',
  },
];

describe('RecommendedNewsletters', () => {
  it('shows the stored list under its topics with sign-up links and Reload', () => {
    const html = renderToStaticMarkup(
      <RecommendedNewsletters
        stored={{ picks, madeAt: '2026-09-24T09:00:00Z' }}
        address="abc@news.example.com"
        timezone="Europe/London"
      />,
    );
    expect(html).toContain('href="https://importai.substack.com/"');
    expect(html).toContain('Weekly notes on machine learning research.');
    expect(html).toContain('abc@news.example.com');
    expect(html).toContain('Reload');
    expect(html).toContain('Made 24 Sept, 10:00');
    // One heading per topic that has picks, in the order of NEWS_TOPICS.
    // Technology is first in the stored list and second on the page.
    expect(html.indexOf('>Business<')).toBeGreaterThan(-1);
    expect(html.indexOf('>Technology<')).toBeGreaterThan(html.indexOf('>Business<'));
    // Only the publisher that differs from the name is shown beside it.
    expect(html).toContain('Jack Clark');
  });

  it('offers to make the list when none is stored', () => {
    const html = renderToStaticMarkup(
      <RecommendedNewsletters stored={null} address={null} timezone="UTC" />,
    );
    expect(html).toContain('Make the list');
    expect(html).toContain('no mail domain');
  });
});
