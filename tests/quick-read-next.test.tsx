/**
 * Quick read's phone card holds Next at the foot of the window (note
 * 1736597c), so it is in the same place on every story rather than wherever
 * the story happened to end.
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
  it('holds Next on a sticky row of its own', () => {
    const html = render();
    const row = html.match(/<div class="[^"]*\bsticky\b[^"]*">(.*?)<\/div>/);
    expect(row).not.toBeNull();
    expect(row![1]).toContain('id="quick-read-next"');
  });

  it('draws the story behind it only once a swipe starts (note 3164d419)', () => {
    // The story coming in carries its own Next form; drawn from the start, the
    // page would hold two forms with one id and a story nobody can see.
    const html = render(true);
    expect(html.match(/id="quick-read-next"/g)).toHaveLength(1);
    expect(html).not.toContain('The one behind it');
  });

  it('lets the card clip without becoming a scroll container', () => {
    // overflow-hidden would make the card the box the row sticks in.
    expect(render()).not.toContain('overflow-hidden');
  });
});
