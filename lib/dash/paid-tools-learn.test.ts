import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SchemaClient } from '@/lib/ask/db';
import { LEARN_PAID_TOOLS } from './paid-tools-learn';
import type { DashPaidCheckContext, DashPaidTool } from './registry';

/**
 * The checks Learn's paid tools make before a press is queued (plan #2228.4).
 * What each runs, and what it records, is paid-actions.test.ts's.
 */

const ME = '00000000-0000-4000-8000-00000000000a';
const ROW = '00000000-0000-4000-8000-0000000000b1';

/** A client whose every read returns `row`. */
function reading(row: Record<string, unknown> | null): SchemaClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => query } as unknown as SchemaClient;
}

function context(row: Record<string, unknown> | null = null): DashPaidCheckContext {
  return {
    userId: ME,
    today: '2026-10-16',
    timezone: 'UTC',
    enabledModules: ['learn'],
    db: async () => reading(row),
    searchSources: [],
    now: Date.parse('2026-10-16T12:00:00Z'),
    seen: () => true,
  };
}

const tool = (name: string): DashPaidTool => LEARN_PAID_TOOLS.find((t) => t.name === name)!;

describe('Learn paid tools', () => {
  const key = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
  });

  it('each runs in Learn and names its button', () => {
    for (const t of LEARN_PAID_TOOLS) {
      expect(t.workspace).toBe('learn');
      expect(t.action.startsWith('app/learn/')).toBe(true);
      expect(t.definition.name).toBe(t.name);
    }
  });

  it('drafts a topic for a subject of theirs, and refuses one that is not', async () => {
    const draft = tool('draft_topic');
    expect(await draft.prepare(context(), { name: 'x' })).toMatchObject({ ok: false });
    expect(await draft.prepare(context(null), { name: 'DCF', subject_id: ROW })).toEqual({
      ok: false,
      error: 'That subject is not one of theirs.',
    });
    expect(await draft.prepare(context({ id: ROW, name: 'Finance' }), { name: 'DCF', subject_id: ROW })).toEqual({
      ok: true,
      args: { name: 'DCF', scope: null, subjectId: ROW, forTopicId: null },
      line: 'Draft the topic DCF, for Finance.',
      paths: ['/learn/topics', '/learn/know'],
    });
  });

  it('queues a draft with no model key, since the routine writes it (learn 0193)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await tool('draft_topic').prepare(context(), { name: 'DCF' })).toMatchObject({ ok: true, line: 'Draft the topic DCF.' });
  });

  it('makes a subject with the units they named, in their order', async () => {
    const prepared = await tool('make_learn_subject').prepare(context(), {
      name: 'Rust',
      units: ['Ownership', ' ', 'Lifetimes'],
    });
    expect(prepared).toEqual({
      ok: true,
      args: { name: 'Rust', want: null, units: 'Ownership\nLifetimes' },
      line: 'Make the subject Rust with your 2 units.',
      paths: ['/learn/know'],
    });
  });

  it('starts again only a brief whose run failed', async () => {
    const retry = tool('retry_research_brief');
    expect(await retry.prepare(context({ id: ROW, question: 'Why tides?', status: 'done' }), { brief_id: ROW })).toEqual({
      ok: false,
      error: 'Only a brief whose run failed can be started again.',
    });
    expect(await retry.prepare(context({ id: ROW, question: 'Why tides?', status: 'failed' }), { brief_id: ROW })).toMatchObject({
      ok: true,
      line: 'Start the research again on the brief “Why tides?”.',
    });
  });

  it('refuses an id that is not a uuid without reading', async () => {
    for (const [name, field] of [
      ['summarize_reading', 'reading_id'],
      ['write_quiz_questions', 'quiz_id'],
      ['write_subject_curriculum', 'subject_id'],
    ] as const) {
      expect(await tool(name).prepare(context({ id: 'x' }), { [field]: 'not-an-id' })).toMatchObject({ ok: false });
    }
  });
});
