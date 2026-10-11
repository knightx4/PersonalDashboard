import { describe, expect, it } from 'vitest';
import type { DevComment } from '@/lib/comments/load';
import { interviewCards, interviewCardView } from './interview-view';
import type { SpecInterview } from './interviews';

function turn(id: string, author: 'me' | 'claude'): DevComment {
  return { id, author, body: id, createdAt: '2026-10-07T09:00:00Z' };
}

function interview(over: Partial<SpecInterview>): SpecInterview {
  return {
    id: 'i1',
    module: 'jobs',
    status: 'open',
    questionLimit: 12,
    draftRequestedAt: null,
    summary: null,
    visionReviewId: null,
    specChangeId: null,
    startedAt: '2026-10-07T09:00:00Z',
    finishedAt: null,
    turns: [],
    ...over,
  };
}

const NONE = { visionEditIds: new Set<string>(), specChangeIds: new Set<string>() };

describe('interviewCardView', () => {
  it('counts what was asked and answered, and whose move it is', () => {
    const view = interviewCardView(
      interview({ turns: [turn('q1', 'claude'), turn('a1', 'me'), turn('q2', 'claude')] }),
      NONE,
    );
    expect(view).toMatchObject({ status: 'open', move: 'answer', asked: 2, answered: 1 });
    expect(view.visionHref).toBeNull();
  });

  it('links a drafted interview to the drafts still waiting, and not to decided ones', () => {
    const drafted = interview({ status: 'drafted', visionReviewId: 'v1', specChangeId: 'c1' });
    const waiting = interviewCardView(drafted, {
      visionEditIds: new Set(['v1']),
      specChangeIds: new Set(['c1']),
    });
    expect(waiting.visionHref).toBe('/dev/specs#vision-jobs');
    expect(waiting.specChangeHref).toBe('/dev/specs#spec-change-c1');
    expect(waiting.move).toBeNull();

    const decided = interviewCardView(drafted, { visionEditIds: new Set(['v1']), specChangeIds: new Set() });
    expect(decided.specChangeHref).toBeNull();
  });
});

describe('interviewCards', () => {
  it('shows the open interview over a drafted one for the same workspace', () => {
    const cards = interviewCards(
      [
        interview({ id: 'open' }),
        interview({ id: 'old', status: 'drafted', visionReviewId: 'v1' }),
      ],
      { visionEditIds: new Set(['v1']), specChangeIds: new Set() },
    );
    expect(cards.jobs?.id).toBe('open');
  });

  it('shows the latest drafted interview only while a draft of its waits', () => {
    const list = [
      interview({ id: 'new', status: 'drafted', visionReviewId: 'v2', specChangeId: 'c2' }),
      interview({ id: 'old', status: 'drafted', visionReviewId: 'v1', specChangeId: 'c1' }),
      interview({ id: 'gone', module: 'app', status: 'abandoned' }),
    ];
    expect(interviewCards(list, { visionEditIds: new Set(['v2']), specChangeIds: new Set() }).jobs?.id).toBe('new');
    // Both of the latest's drafts decided: no card, and the older one is not brought back.
    const none = interviewCards(list, { visionEditIds: new Set(['v1']), specChangeIds: new Set(['c1']) });
    expect(none).toEqual({});
  });
});
