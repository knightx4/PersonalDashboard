import { describe, expect, it, vi } from 'vitest';
import { writeLevelLessonWith } from '@/inngest/learn/level-lesson';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { SpendClient } from '@/lib/core/spend/record';
import { lessonPrompt, type LessonResult, type writeLesson } from '@/lib/learn/lessons/write-lesson';
import { levelClaim, levelLessonInput, levelSourceQuery } from './level-lesson';

const USER = 'user-1';
const LEVEL = {
  topicName: 'Unit economics',
  scope: 'What one customer earns and costs over their life.',
  level: 3,
  descriptor: ['Explains why CAC is paid back from gross margin, not revenue', 'Says what drives LTV up or down'],
};

describe('the level lesson input', () => {
  it('states the level as the claim and the checks as mastery', () => {
    const input = levelLessonInput(LEVEL, null);
    expect(input.concept.name).toBe('Unit economics');
    expect(input.concept.claim).toBe(levelClaim(LEVEL));
    expect(input.concept.claim).toContain('level 3');
    expect(input.concept.mastery).toEqual(LEVEL.descriptor);
    expect(levelSourceQuery(LEVEL)).toContain('Says what drives LTV');
  });

  it('tells the writer it teaches a level, at that depth, on the topic', () => {
    const prompt = lessonPrompt(levelLessonInput(LEVEL, null));
    expect(prompt).toContain('Topic: Unit economics. It covers: What one customer earns');
    expect(prompt).toContain('level 3 of 10');
    expect(prompt).toContain('no deeper');
    expect(prompt).not.toContain('Track:');
    expect(prompt).toContain('- Says what drives LTV up or down');
  });
});

/** A learn client holding the rows these reads and the insert touch. */
function fakeLearn(tables: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    const rows = () => (tables[table] ?? []).filter((row) => filters.every(([k, v]) => row[k] === v));
    const builder = {
      select: () => builder,
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return builder;
      },
      or: () => builder,
      in: () => builder,
      order: () => builder,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        (tables[table] ??= []).push({ id: `ll-${(tables[table] ?? []).length + 1}`, read_at: null, ...row });
        return { error: null };
      },
    };
    return builder;
  };
  return { from } as unknown as LearnSupabaseClient;
}

const core = { from: () => ({ insert: async () => ({ error: null }) }) } as unknown as SpendClient;

const READY: LessonResult = {
  outcome: 'ready',
  card: {
    name: 'Unit economics',
    takeaway: 'A customer pays back what it cost to win only out of the margin it brings in.',
    context: 'CAC is what winning one customer costs.',
    hook: 'A 70% margin at $100 a month pays back $1,400 of CAC in 20 months.',
    summary: 'Revenue also has to cover the cost of serving the customer.',
    example: 'A meal-kit firm with thin margins.',
    question: 'Why does a 20% margin stretch payback?',
    answer: 'Less of each payment is left to repay the cost.',
  },
  predict: null,
  figures: [],
  source: null,
};

describe('writeLevelLessonWith', () => {
  it('writes and stores the lesson once, then reuses it without a model call', async () => {
    const tables = {
      topic_cells: [{ id: 'cell-3', topic_id: 'topic-ue', level: 3, descriptor: LEVEL.descriptor }],
      topics: [{ id: 'topic-ue', name: 'Unit economics', scope: LEVEL.scope }],
      level_lessons: [] as Record<string, unknown>[],
    };
    const learn = fakeLearn(tables);
    const write = vi.fn(async () => READY) as unknown as typeof writeLesson;
    const findSource = vi.fn(async () => null);
    const ports = { learn, core, apiKey: 'key', write, findSource };

    const first = await writeLevelLessonWith(ports, USER, 'cell-3');
    expect(first).toMatchObject({ ok: true, lesson: { topicName: 'Unit economics', level: 3, read: false } });
    expect(first.ok && first.lesson.lesson?.takeaway).toContain('margin');
    expect(tables.level_lessons).toHaveLength(1);
    expect(tables.level_lessons[0]).toMatchObject({ user_id: USER, cell_id: 'cell-3', status: 'ready' });

    const again = await writeLevelLessonWith(ports, USER, 'cell-3');
    expect(again).toMatchObject({ ok: true, lesson: { id: first.ok ? first.lesson.id : '' } });
    expect(write).toHaveBeenCalledTimes(1);
    expect(findSource).toHaveBeenCalledTimes(1);
  });

  it('stores a declined lesson as dropped, so it is not paid for again', async () => {
    const tables = {
      topic_cells: [{ id: 'cell-3', topic_id: 'topic-ue', level: 3, descriptor: LEVEL.descriptor }],
      topics: [{ id: 'topic-ue', name: 'Unit economics', scope: null }],
      level_lessons: [] as Record<string, unknown>[],
    };
    const write = vi.fn(async () => ({ outcome: 'dropped', reason: 'Too vague.', contradicted: false, source: null })) as unknown as typeof writeLesson;
    const result = await writeLevelLessonWith({ learn: fakeLearn(tables), core, apiKey: 'key', write, findSource: async () => null }, USER, 'cell-3');
    expect(result).toMatchObject({ ok: true, lesson: { lesson: null, dropped: 'Too vague.' } });
  });

  it('stores nothing when the call fails', async () => {
    const tables = {
      topic_cells: [{ id: 'cell-3', topic_id: 'topic-ue', level: 3, descriptor: LEVEL.descriptor }],
      topics: [{ id: 'topic-ue', name: 'Unit economics', scope: null }],
      level_lessons: [] as Record<string, unknown>[],
    };
    const write = vi.fn(async () => ({ outcome: 'failed', detail: 'Rate limited.' })) as unknown as typeof writeLesson;
    const result = await writeLevelLessonWith({ learn: fakeLearn(tables), core, apiKey: 'key', write, findSource: async () => null }, USER, 'cell-3');
    expect(result).toEqual({ ok: false, detail: 'Rate limited.' });
    expect(tables.level_lessons).toHaveLength(0);
  });
});
