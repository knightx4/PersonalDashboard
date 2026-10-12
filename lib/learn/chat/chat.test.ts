import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { addChatReadings, findReadings, logChatSession, markChatReadingRead } from './readings';
import { cleanSubjectNames, resolveChatSubjects } from './subjects';

/**
 * What a chat writes into Learn (plan #1809, #1811, #1812), against a fake
 * learn client that records each query and answers it from a handler.
 */

type Query = { table: string; op: string; values: unknown; filters: [string, unknown[]][] };

function fakeLearn(answer: (query: Query) => { data?: unknown; error?: unknown; count?: number }) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, op: 'select', values: null, filters: [] };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop: string) {
          if (prop === 'then') {
            const { data = null, error = null, count } = answer(query);
            return (resolve: (value: unknown) => unknown) => resolve({ data, error, count });
          }
          return (...args: unknown[]) => {
            if (['insert', 'update', 'upsert', 'delete'].includes(prop)) {
              query.op = prop;
              query.values = args[0];
            } else if (prop !== 'select' || query.op === 'select') {
              query.filters.push([prop, args]);
            }
            return proxy;
          };
        },
      };
      const proxy = new Proxy(builder, handler);
      return proxy;
    },
  };
  return { learn: client as unknown as LearnSupabaseClient, queries };
}

function filterValue(query: Query, name: string, column: string): unknown {
  return query.filters.find(([method, args]) => method === name && args[0] === column)?.[1][1];
}

describe('cleanSubjectNames', () => {
  it('trims, dedupes case-insensitively and keeps at most three', () => {
    expect(cleanSubjectNames([' AI  agents ', 'ai agents', 'Evals', 3, '', 'Prompts', 'Context'])).toEqual([
      'AI agents',
      'Evals',
      'Prompts',
    ]);
  });
});

describe('resolveChatSubjects', () => {
  const existing = [
    { id: 's1', name: 'Agentic AI Systems' },
    { id: 's2', name: 'Evals' },
  ];

  function modelSays(matches: { name: string; subject: string | null }[]) {
    const create = vi.fn(async () => ({
      content: [{ type: 'tool_use', name: 'report_matches', input: { matches } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    return { client: { messages: { create } } as unknown as Anthropic, create };
  }

  it('takes an exact name without asking a model, and filters every read to the person', async () => {
    const { learn, queries } = fakeLearn(() => ({ data: existing }));
    const { client, create } = modelSays([]);

    const subjects = await resolveChatSubjects(learn, 'me', ['evals'], { anthropicApiKey: 'k', client });

    expect(subjects).toEqual([{ id: 's2', name: 'Evals', created: false }]);
    expect(create).not.toHaveBeenCalled();
    expect(filterValue(queries[0], 'eq', 'user_id')).toBe('me');
  });

  it('files a reworded name under the subject the model matched', async () => {
    const { learn } = fakeLearn(() => ({ data: existing }));
    const { client } = modelSays([{ name: 'AI agents', subject: 'Agentic AI Systems' }]);

    const subjects = await resolveChatSubjects(learn, 'me', ['AI agents'], { anthropicApiKey: 'k', client });

    expect(subjects).toEqual([{ id: 's1', name: 'Agentic AI Systems', created: false }]);
  });

  it('makes a new subject for a name nothing matches, with the note given', async () => {
    const { learn, queries } = fakeLearn((query) =>
      query.op === 'insert' ? { data: { id: 'new', name: 'Prompt design' } } : { data: existing },
    );
    const { client } = modelSays([{ name: 'Prompt design', subject: null }]);

    const subjects = await resolveChatSubjects(learn, 'me', ['Prompt design'], {
      anthropicApiKey: 'k',
      client,
      note: 'How to build reliable agents',
    });

    expect(subjects).toEqual([{ id: 'new', name: 'Prompt design', created: true }]);
    expect(queries.find((query) => query.op === 'insert')?.values).toEqual({
      user_id: 'me',
      name: 'Prompt design',
      note: 'How to build reliable agents',
    });
  });

  it('makes the subject when there is no key to ask with', async () => {
    const { learn } = fakeLearn((query) =>
      query.op === 'insert' ? { data: { id: 'new', name: 'AI agents' } } : { data: existing },
    );

    const subjects = await resolveChatSubjects(learn, 'me', ['AI agents'], { anthropicApiKey: undefined });

    expect(subjects[0]).toMatchObject({ id: 'new', created: true });
  });
});

describe('addChatReadings', () => {
  const subjects = [{ id: 's1', name: 'Agentic AI Systems', created: false }];

  it('adds new works to the conversations list, keeps one already on a list, and relates both to the subjects', async () => {
    let inserted = 0;
    const { learn, queries } = fakeLearn((query) => {
      if (query.table === 'tracks') return { data: { id: 'list' } };
      if (query.table === 'readings' && query.op === 'select' && filterValue(query, 'eq', 'track_id') === 'list') {
        return { data: { position: 20 } };
      }
      if (query.table === 'readings' && query.op === 'select') {
        return { data: [{ id: 'old', title: null, status: 'queued', sources: { title: 'Building Effective Agents' } }] };
      }
      if (query.table === 'readings' && query.op === 'insert') return { data: { id: `r${++inserted}` } };
      return { data: null };
    });

    const added = await addChatReadings(learn, 'me', {
      question: 'How do I build reliable agents?',
      subjects,
      items: [
        { title: 'Building Effective Agents', author: 'Anthropic', url: null, why: 'The clearest map.' },
        { title: 'Your AI Product Needs Evals', author: 'Hamel Husain', url: null, why: 'The most practical material.' },
      ],
    });

    expect(added).toEqual({
      trackId: 'list',
      readings: [
        { id: 'old', title: 'Building Effective Agents', added: false },
        { id: 'r1', title: 'Your AI Product Needs Evals', added: true },
      ],
    });

    const reading = queries.find((query) => query.table === 'readings' && query.op === 'insert')!.values as Record<string, unknown>;
    expect(reading).toMatchObject({
      user_id: 'me',
      track_id: 'list',
      source_id: null,
      title: 'Your AI Product Needs Evals',
      why: 'The most practical material.',
      position: 30,
      locator_confidence: 'unverified',
    });
    expect(reading.find_after).toEqual(expect.any(String));

    const related = queries.find((query) => query.table === 'reading_subjects')!.values;
    expect(related).toEqual([
      { user_id: 'me', reading_id: 'old', subject_id: 's1' },
      { user_id: 'me', reading_id: 'r1', subject_id: 's1' },
    ]);
    const imported = queries.find((query) => query.table === 'imports')!.values as Record<string, unknown>;
    expect(imported).toMatchObject({ user_id: 'me', track_id: 'list', source_hint: 'conversation' });
    // imports_parsed_is_array_ck refuses anything but a list.
    expect(Array.isArray(imported.parsed)).toBe(true);
    expect(imported.raw_text).toMatch(/^Question: How do I build reliable agents\?\n/);
  });
});

describe('findReadings', () => {
  it('matches every word against the title or its source, unread first', async () => {
    const { learn } = fakeLearn(() => ({
      data: [
        { id: 'a', title: null, status: 'read', sources: { title: 'Writing Effective Tools for Agents' } },
        { id: 'b', title: 'Effective context engineering for agents', status: 'queued', sources: null },
        { id: 'c', title: 'DSPy', status: 'queued', sources: null },
      ],
    }));

    const found = await findReadings(learn, 'me', 'effective agents');

    expect(found.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('markChatReadingRead', () => {
  it('keeps the note already there above the new one, and takes it off the shelf', async () => {
    const { learn, queries } = fakeLearn((query) =>
      query.op === 'update'
        ? { data: { id: 'r1', title: 'DSPy', status: 'read' } }
        : { data: { id: 'r1', title: 'DSPy', note: 'Started on the intro.', status: 'reading' } },
    );

    await markChatReadingRead(learn, 'me', 'r1', 'Prompts as parameters against a metric.');

    const update = queries.find((query) => query.op === 'update')!;
    expect(update.values).toEqual({
      status: 'read',
      read_now_at: null,
      note: 'Started on the intro.\n\nPrompts as parameters against a metric.',
    });
    expect(filterValue(update, 'eq', 'user_id')).toBe('me');
  });
});

describe('logChatSession', () => {
  it('logs the session and adds only the ideas the subject lacks, with no state', async () => {
    const { learn, queries } = fakeLearn((query) => {
      if (query.table === 'learning_log') return { data: { id: 'log1' } };
      if (query.table === 'concepts' && query.op === 'select') return { data: [{ name: 'Eval-driven iteration' }] };
      return { data: null };
    });

    const logged = await logChatSession(learn, 'me', {
      topic: 'Evals',
      question: null,
      summary: 'Define good, build a test set, read failures, change one thing at a time.',
      ideas: [
        { name: 'Eval-driven iteration', claim: 'Change one thing at a time and re-run the set.' },
        { name: 'Reading failures', claim: 'Reading failed cases teaches more than the score.' },
      ],
      subject: { id: 's2', name: 'Evals', created: false },
    });

    expect(logged).toEqual({ id: 'log1', conceptsAdded: 1, conceptsKnown: 1 });
    const concepts = queries.find((query) => query.table === 'concepts' && query.op === 'insert')!.values;
    expect(concepts).toEqual([
      expect.objectContaining({ user_id: 'me', subject_id: 's2', name: 'Reading failures', origin: 'conversation' }),
    ]);
    expect(queries.some((query) => query.table === 'concept_state')).toBe(false);
  });
});
