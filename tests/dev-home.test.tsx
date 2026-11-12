/**
 * Home in Dev: the strip of chips at the top, and the conversations split by
 * whether Dash has written since you last looked.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MainCheck } from '@/lib/plan/main-check';
import type { Conversation } from '@/lib/comments/recent';

vi.mock('@/app/dev/raised/actions', () => ({ markConversationRead: async () => ({}) }));

const { NowStrip } = await import('@/app/dev/raised/now-strip');
const { ConversationsView } = await import('@/app/dev/raised/conversations-view');

function check(over: Partial<MainCheck> = {}): MainCheck {
  return {
    sha: 'abc1234',
    conclusion: 'passed',
    checkedAt: '2026-10-06T07:55:00Z',
    error: null,
    reason: null,
    runUrl: null,
    deployState: null,
    deployUrl: null,
    deployError: null,
    unapplied: [],
    migrationsError: null,
    ...over,
  };
}

describe('the strip at the top of Home', () => {
  it('says what is running and what is waiting, each a link to its page', () => {
    const html = renderToStaticMarkup(
      <NowStrip run={null} ready={3} openNotes={12} mainCheck={check()} inbox={4} slips={null} sessions={null} />,
    );
    expect(html).toContain('Resting · 3 ready');
    expect(html).toContain('12 open');
    expect(html).toContain('Green');
    expect(html).toContain('4 waiting');
    expect(html).toContain('href="/dev/inbox"');
    expect(html).toContain('href="/dev/bugs"');
  });

  it('reads unapplied migrations as main not being fine', () => {
    const html = renderToStaticMarkup(
      <NowStrip
        run={null}
        ready={0}
        openNotes={0}
        mainCheck={check({ unapplied: ['0190_x.sql', '0191_y.sql'] })}
        inbox={0}
        slips={{ count: 0, newestHref: null }}
        sessions={{ working: 0, waiting: 0 }}
      />,
    );
    expect(html).toContain('2 migrations unapplied');
    expect(html).not.toContain('Green');
    expect(html).toContain('Clear');
    expect(html).toContain('None in 7 days');
    expect(html).toContain('None open');
  });

  it('counts the chat slips of the last seven days and opens where the newest happened (plan #2999)', () => {
    const html = renderToStaticMarkup(
      <NowStrip
        run={null}
        ready={0}
        openNotes={0}
        mainCheck={check()}
        inbox={0}
        slips={{ count: 3, newestHref: '/chat/people/builder' }}
        sessions={{ working: 2, waiting: 1 }}
      />,
    );
    expect(html).toContain('Chat slips');
    expect(html).toContain('3 in 7 days');
    expect(html).toContain('href="/chat/people/builder"');
    expect(html).toContain('Sessions');
    expect(html).toContain('2 working · 1 waiting');
    expect(html).not.toContain('Browser runner');
  });

  it('says whether the browser runner is up on the PC or the Mac (plan #3075)', () => {
    const strip = (browserRunner: { value: string; up: boolean } | null) =>
      renderToStaticMarkup(
        <NowStrip
          run={null}
          ready={0}
          openNotes={0}
          mainCheck={check()}
          inbox={0}
          slips={null}
          sessions={null}
          browserRunner={browserRunner}
        />,
      );
    expect(strip({ value: 'Never run', up: false })).toContain('Never run');
    expect(strip({ value: 'PC up', up: true })).toContain('PC up');
    expect(strip(null)).toContain('Browser runner');
  });
});

function conversation(over: Partial<Conversation> & Pick<Conversation, 'rowId' | 'lastAt'>): Conversation {
  return {
    target: 'idea',
    about: `About ${over.rowId}`,
    href: '/dev/ideas',
    thread: [],
    lastAuthor: 'claude',
    unread: false,
    ...over,
  };
}

describe('the conversations on Home', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');

  it('puts what Dash replied to first, then the week, then the older ones folded', () => {
    const html = renderToStaticMarkup(
      <ConversationsView
        now={now}
        conversations={[
          conversation({ rowId: 'new', lastAt: '2026-10-08T09:00:00Z', unread: true }),
          conversation({ rowId: 'week', lastAt: '2026-10-05T09:00:00Z' }),
          conversation({ rowId: 'old', lastAt: '2026-09-01T09:00:00Z' }),
        ]}
      />,
    );
    const replied = html.indexOf('Dash replied');
    const week = html.indexOf('This week');
    const older = html.indexOf('Older');
    expect(replied).toBeGreaterThan(-1);
    expect(replied).toBeLessThan(html.indexOf('About new'));
    expect(html.indexOf('About new')).toBeLessThan(week);
    expect(week).toBeLessThan(html.indexOf('About week'));
    expect(older).toBeLessThan(html.indexOf('About old'));
  });

  it('draws no heading over an empty part', () => {
    const html = renderToStaticMarkup(
      <ConversationsView now={now} conversations={[conversation({ rowId: 'week', lastAt: '2026-10-07T09:00:00Z' })]} />,
    );
    expect(html).not.toContain('Dash replied');
    expect(html).not.toContain('Older');
  });
});
