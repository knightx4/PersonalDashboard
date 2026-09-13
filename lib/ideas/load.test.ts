import { describe, expect, it } from 'vitest';
import { IDEA_COLUMNS, ideaListFrom, ideaRowFrom } from '@/lib/ideas/load';

const idea = (over: {
  id: string;
  source?: string;
  dismissed_at?: string | null;
  plan_item?: { id: string; number: number; title: string; status: string } | null;
  from_plan_item?: { number: number; title: string } | null;
}) => ({
  id: over.id,
  body: `idea ${over.id}`,
  module: 'dev',
  created_at: '2026-09-12T09:00:00Z',
  source: over.source ?? 'me',
  dismissed_at: over.dismissed_at ?? null,
  plan_item: over.plan_item ?? null,
  from_plan_item: over.from_plan_item ?? null,
});

describe('the ideas list', () => {
  it('keeps suggestions out of your own list', () => {
    const list = ideaListFrom(
      [idea({ id: 'mine' }), idea({ id: 'suggested', source: 'claude' })].map(ideaRowFrom),
    );

    expect(list.mine.map((row) => row.id)).toEqual(['mine']);
    expect(list.suggested.map((row) => row.id)).toEqual(['suggested']);
  });

  it('takes a dismissed idea out of every live pile', () => {
    const list = ideaListFrom(
      [
        idea({ id: 'put-aside', source: 'claude', dismissed_at: '2026-09-13T09:00:00Z' }),
        idea({
          id: 'dismissed-but-shaped',
          dismissed_at: '2026-09-13T09:00:00Z',
          plan_item: { id: 'a', number: 12, title: 'A feature', status: 'proposed' },
        }),
      ].map(ideaRowFrom),
    );

    expect(list.dismissed.map((row) => row.id)).toEqual(['put-aside', 'dismissed-but-shaped']);
    expect(list.suggested).toEqual([]);
    expect(list.shaped).toEqual([]);
    expect(list.mine).toEqual([]);
  });

  it('moves a shaped idea out of the pile it was in', () => {
    const list = ideaListFrom(
      [
        idea({
          id: 'shaped',
          source: 'claude',
          plan_item: { id: 'a', number: 12, title: 'A feature', status: 'proposed' },
        }),
      ].map(ideaRowFrom),
    );

    expect(list.shaped.map((row) => row.id)).toEqual(['shaped']);
    expect(list.suggested).toEqual([]);
  });

  it('reads the feature a suggestion came out of', () => {
    const [row] = [
      idea({
        id: 'suggested',
        source: 'claude',
        from_plan_item: { number: 338, title: 'Talk back to Claude inside the app' },
      }),
    ].map(ideaRowFrom);

    expect(row.from).toEqual({ number: 338, title: 'Talk back to Claude inside the app' });
  });

  it('reads an unknown source as yours', () => {
    const [row] = [idea({ id: 'odd', source: 'somebody-else' })].map(ideaRowFrom);

    expect(row.source).toBe('me');
  });

  it('selects the dismissal, so the page can tell a live idea from a put-aside one', () => {
    expect(IDEA_COLUMNS).toContain('dismissed_at');
  });
});
