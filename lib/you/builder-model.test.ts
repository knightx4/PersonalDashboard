import { describe, expect, it } from 'vitest';
import { assembleChatContext, type ChatContextInput } from '@/lib/you/chat-context-model';
import { canTalkOf } from '@/lib/you/people-cards-model';
import { BUILDER_TEXTS } from '@/lib/you/first-texts';
import {
  BUILDER_KEY,
  BUILDER_RULES,
  devBriefLines,
  devBriefOf,
  LIST_MAX,
  type BriefItem,
} from './builder-model';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const refOf = (n: number) => `#${n}.1`;

const item = (over: Partial<BriefItem> & { id: string; number: number }): BriefItem => ({
  title: `Step ${over.number}`,
  status: 'not_started',
  kind: 'build',
  completedAt: null,
  ...over,
});

describe('devBriefOf', () => {
  it('sorts what waits on the person, blocked first, with run questions among them', () => {
    const brief = devBriefOf({
      items: [],
      refOf,
      waiting: [
        { id: 'a', number: 1, title: 'Approve it', health: 'proposed', ask: null },
        { id: 'b', number: 2, title: 'Which shape?', health: 'unanswered', ask: 'A or B' },
        { id: 'c', number: 3, title: 'Stuck', health: 'blocked', ask: 'Needs a token' },
      ],
      runQuestions: [{ runId: 'r', about: '#9.1 Something', body: 'Which colour?' }],
      progress: [],
      runs: [],
      now: NOW,
    });
    expect(brief.waiting.map((w) => w.why)).toEqual(['blocked', 'run question', 'question', 'proposal']);
    expect(brief.waiting[0]).toMatchObject({ ref: '#3.1', ask: 'Needs a token' });
  });

  it('lists a session by its report, and a run that has not reported by its push', () => {
    const brief = devBriefOf({
      items: [item({ id: 's1', number: 1 }), item({ id: 's2', number: 2 })],
      refOf,
      waiting: [],
      runQuestions: [],
      progress: [
        { planItemId: 's1', planRunId: 'r1', state: 'working', action: 'Committed abc', needs: null, updatedAt: hoursAgo(0.5) },
        // Too old to count as building, and on a run that is over.
        { planItemId: 's1', planRunId: 'old', state: 'working', action: 'Gone', needs: null, updatedAt: hoursAgo(5) },
      ],
      runs: [
        { id: 'r1', planItemId: 's1', status: 'started', createdAt: hoursAgo(1), lastPushSubject: null },
        { id: 'r2', planItemId: 's2', status: 'started', createdAt: hoursAgo(1), lastPushSubject: 'Add the page' },
      ],
      now: NOW,
    });
    expect(brief.building).toEqual([
      { ref: '#1.1', title: 'Step 1', action: 'Committed abc', needs: null, at: hoursAgo(0.5) },
      { ref: '#2.1', title: 'Step 2', action: 'Pushed: Add the page', needs: null, at: hoursAgo(1) },
    ]);
  });

  it('puts a session waiting on the person first', () => {
    const brief = devBriefOf({
      items: [item({ id: 's1', number: 1 }), item({ id: 's2', number: 2 })],
      refOf,
      waiting: [],
      runQuestions: [],
      progress: [
        { planItemId: 's1', planRunId: null, state: 'working', action: 'Writing tests', needs: null, updatedAt: hoursAgo(0.1) },
        { planItemId: 's2', planRunId: null, state: 'waiting', action: 'Asked', needs: 'a token', updatedAt: hoursAgo(1) },
      ],
      runs: [],
      now: NOW,
    });
    expect(brief.building.map((b) => b.needs)).toEqual(['a token', null]);
  });

  it('counts what shipped in the last two days, newest first, build steps only', () => {
    const brief = devBriefOf({
      items: [
        item({ id: 'a', number: 1, status: 'done', completedAt: hoursAgo(30) }),
        item({ id: 'b', number: 2, status: 'done', completedAt: hoursAgo(2) }),
        item({ id: 'c', number: 3, status: 'done', completedAt: hoursAgo(60) }),
        item({ id: 'd', number: 4, status: 'done', kind: 'decision', completedAt: hoursAgo(1) }),
      ],
      refOf,
      waiting: [],
      runQuestions: [],
      progress: [],
      runs: [],
      now: NOW,
    });
    expect(brief.shipped.map((s) => s.ref)).toEqual(['#2.1', '#1.1']);
  });
});

describe('devBriefLines', () => {
  it('says nothing waits, builds or shipped rather than leaving a gap', () => {
    const lines = devBriefLines({ waiting: [], building: [], shipped: [] }, new Date(NOW), 'UTC');
    expect(lines).toEqual([
      'Dev now, read fresh for this reply:',
      'Waiting on them: nothing.',
      'Building now: nothing.',
      'Shipped in the last two days: nothing.',
    ]);
  });

  it('lists up to LIST_MAX of a section and counts the rest', () => {
    const shipped = Array.from({ length: LIST_MAX + 2 }, (_, i) => ({ ref: `#${i}`, title: `Thing ${i}`, at: hoursAgo(i + 1) }));
    const lines = devBriefLines({ waiting: [], building: [], shipped }, new Date(NOW), 'UTC');
    const section = lines.at(-1) ?? '';
    expect(section).toMatch(/^Shipped in the last two days \(8\):/);
    expect(section).toContain('- and 2 more');
    expect(section.split('\n')).toHaveLength(LIST_MAX + 2);
  });

  it('says when the plan could not be read', () => {
    expect(devBriefLines(null, new Date(NOW), 'UTC')[0]).toMatch(/could not be read/);
  });
});

describe('the builder in a reply', () => {
  const input = (key: string, dev?: ChatContextInput['live']['dev']): ChatContextInput => ({
    mentor: { id: 'm', key, name: 'Builder', kind: 'guest', question: 'Q?', focus: null, persona: 'Brief and plain.', brain: null, madeByYou: false },
    memory: [],
    episodes: [],
    recall: [],
    recent: [{ id: 'x', role: 'person', kind: 'reply', text: "what's going on?", createdAt: hoursAgo(0) }],
    live: { now: new Date(NOW), timeZone: 'UTC', place: 'London', nowNote: null, todos: [{ title: 'Call the bank', dueOn: null, pinned: true }], goals: [], dev },
  });

  it('is told it builds the app, with its rules after its card', () => {
    const ctx = assembleChatContext(input(BUILDER_KEY, { waiting: [], building: [], shipped: [] }));
    expect(ctx.layers.persona.text).toMatch(/^You are the Builder/);
    expect(ctx.layers.persona.text).toContain('Brief and plain.');
    expect(ctx.layers.persona.text).toContain(BUILDER_RULES);
    expect(ctx.layers.persona.text).not.toContain('mentors');
  });

  it('reads Dev now in place of todos', () => {
    const ctx = assembleChatContext(input(BUILDER_KEY, { waiting: [], building: [], shipped: [] }));
    expect(ctx.layers.live.text).toContain('Waiting on them: nothing.');
    expect(ctx.layers.live.text).not.toContain('Call the bank');
  });

  it('leaves a mentor as it was', () => {
    const ctx = assembleChatContext(input('mentor'));
    expect(ctx.layers.persona.text).toContain("one of the person's mentors");
    expect(ctx.layers.live.text).toContain('Call the bank');
  });

  it('can talk once it has a card, and texts first by the builder rule', () => {
    expect(canTalkOf({ key: BUILDER_KEY, kind: 'guest', brainStatus: 'none', madeByYou: false, hasPersona: true })).toBe(true);
    expect(canTalkOf({ key: BUILDER_KEY, kind: 'guest', brainStatus: 'none', madeByYou: false, hasPersona: false })).toBe(false);
    expect(canTalkOf({ key: 'someone', kind: 'guest', brainStatus: 'none', madeByYou: false, hasPersona: true })).toBe(false);
    expect(BUILDER_TEXTS.key).toBe(BUILDER_KEY);
  });
});
