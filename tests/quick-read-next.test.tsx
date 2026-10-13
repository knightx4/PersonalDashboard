/**
 * Quick read's phone card holds Next at the foot of the window (note
 * 1736597c), so it is in the same place on every story rather than wherever
 * the story happened to end, and outside the card a swipe drags, so it holds
 * still while one card replaces another (plan #1636).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/news/quick/actions', () => ({}));
vi.mock('@/app/news/quick/discuss-sheet', () => ({ DiscussButton: () => null }));

const { QuickReadView } = await import('@/app/news/quick/quick-view');

const essay = {
  kind: 'essay' as const,
  summary: 'An essay about the projects that pile up.',
  issueId: 'issue-2',
  storyIndex: 0,
  subject: 'On leaving things unfinished',
  receivedAt: '2026-09-20T09:02:00Z',
  sender: null,
  from: 'Slow Letters',
  remainingInIssue: 1,
  alsoIn: [],
  repeats: [],
  reason: null,
};

function render(withNext = false) {
  return renderToStaticMarkup(
    <QuickReadView
      upNext={
        withNext
          ? {
              card: { ...essay, issueId: 'issue-3', subject: 'The one behind it' },
              arrived: null,
              saved: false,
              issueHref: '/news/i/issue-3',
            }
          : null
      }
      card={essay}
      arrived="20 Sep, 09:02"
      nothingYet={false}
      pictures={false}
      picturesHref="/news?pictures=1"
      issueHref="/news/i/issue-2"
      seed="test"
      topics={{ topics: [], selected: null, hrefs: {}, allHref: '/news' }}
    />,
  );
}

describe('the phone card', () => {
  it('holds Next on a row fixed above the tab bar (plan #1636)', () => {
    // Fixed rather than sticky: a sticky row sat under a short card, halfway
    // up the screen, rather than in the same place as on a long one.
    const html = render();
    const row = html.match(/<div class="[^"]*\bfixed\b[^"]*">(.*)$/);
    expect(row).not.toBeNull();
    expect(row![0]).toContain('bottom-[calc(var(--dock-h)');
    expect(row![0]).toContain('w-[100cqw]');
    expect(row![1]).toContain('id="quick-read-next"');
  });

  it('draws the Next row outside the card a swipe drags', () => {
    // So the row holds still while the card goes and the next one comes in.
    const html = render(true);
    const swipe = html.lastIndexOf('<div', html.indexOf('data-quick-swipe'));
    const row = html.lastIndexOf('<div', html.indexOf('class="fixed'));
    expect(swipe).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(swipe);
    // Every div opened inside the swipe is closed again before the row.
    const between = html.slice(swipe, row);
    const opened = between.match(/<div\b/g)?.length ?? 0;
    const closed = between.match(/<\/div>/g)?.length ?? 0;
    expect(closed).toBeGreaterThanOrEqual(opened);
  });

  it('draws the story behind it only once a swipe starts (note 3164d419)', () => {
    // Drawn from the start, the page would hold a story nobody can see, and
    // only the current card's Next row is drawn.
    const html = render(true);
    expect(html.match(/id="quick-read-next"/g)).toHaveLength(1);
    expect(html).not.toContain('The one behind it');
  });
});
