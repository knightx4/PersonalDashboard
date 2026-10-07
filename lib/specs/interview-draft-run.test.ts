import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { WRITE_DRAFTS_TOOL } from '@/lib/dash/interview-draft';
import { applyDiff, countChangedLines } from './changes';
import type { SpecInterview } from './interviews';
import { parseRules } from './rules';

/**
 * Drafting from an interview (plan #1640) with the store and the model
 * faked: a workspace with no spec gets a new one, a workspace with a spec has
 * the draft added to it, the app as a whole gets its own spec, and both
 * proposals cite the interview. The interview finishes as drafted with both
 * ids.
 */

const store = vi.hoisted(() => ({
  current: null as SpecInterview | null,
  finishSpecInterview: vi.fn(async () => {}),
}));

vi.mock('./interviews', async (importOriginal) => {
  const real = await importOriginal<typeof import('./interviews')>();
  return {
    ...real,
    loadSpecInterview: vi.fn(async () => store.current),
    finishSpecInterview: store.finishSpecInterview,
  };
});

const { draftInterview } = await import('./interview-run');

type Op = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };

/** A Supabase client that records each write and answers from `answers`. */
function fakeClient(answers: {
  vision?: string | null;
  pending?: { id: string; proposed_body: string; created_at: string } | null;
  waiting?: { id: string }[];
}) {
  const ops: Op[] = [];
  const builder = (table: string) => {
    const state: Op = { table, op: 'select', filters: [] };
    const resolve = (): { data: unknown; error: unknown } => {
      ops.push(state);
      if (state.op === 'insert' && table === 'spec_changes') return { data: { id: 'change-1' }, error: null };
      if (state.op === 'insert' && table === 'vision_reviews') return { data: { id: 'vision-1' }, error: null };
      if (state.op === 'update' && table === 'vision_reviews') return { data: [{ id: answers.pending?.id }], error: null };
      if (state.op === 'delete') return { data: null, error: null };
      if (table === 'module_visions') return { data: answers.vision ? { body: answers.vision } : null, error: null };
      if (table === 'vision_reviews') return { data: answers.pending ?? null, error: null };
      if (table === 'spec_changes') return { data: answers.waiting ?? [], error: null };
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const name of ['eq', 'in', 'is', 'gte', 'order', 'limit']) {
      chain[name] = (column: string, value: unknown) => {
        if (name === 'eq' || name === 'in') state.filters.push([column, value]);
        return chain;
      };
    }
    chain.select = () => (state.op === 'select' ? chain : self());
    chain.insert = (payload: unknown) => ((state.op = 'insert'), (state.payload = payload), chain);
    chain.update = (payload: unknown) => ((state.op = 'update'), (state.payload = payload), chain);
    chain.delete = () => ((state.op = 'delete'), chain);
    chain.maybeSingle = async () => resolve();
    chain.single = async () => resolve();
    chain.then = (ok: (value: unknown) => unknown, bad: (error: unknown) => unknown) =>
      Promise.resolve(resolve()).then(ok, bad);
    return chain;
  };
  const client = {
    from: builder,
    schema: () => ({ from: builder, rpc: async () => ({ data: null, error: { message: 'not here' } }) }),
  };
  return { client: client as never, ops };
}

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** A model that drafts `inputs` in turn, recording the messages it was sent. */
function fakeModel(inputs: Record<string, unknown>[]) {
  const sent: { tools: { name: string; input_schema: { properties: Record<string, unknown> } }[]; messages: { content: unknown }[] }[] = [];
  return {
    sent,
    client: {
      messages: {
        create: async (params: (typeof sent)[number]) => {
          sent.push(structuredClone(params));
          return {
            content: [{ type: 'tool_use', id: `d${sent.length}`, name: WRITE_DRAFTS_TOOL, input: inputs[sent.length - 1] ?? inputs.at(-1) }],
            stop_reason: 'tool_use',
            usage: USAGE,
          };
        },
      },
    } as unknown as Anthropic,
  };
}

function briefOf(sent: { messages: { content: unknown }[] }): string {
  const content = sent.messages[0]?.content;
  if (typeof content === 'string') return content;
  return (content as { text?: string }[]).map((block) => block.text ?? '').join('');
}

const DRAFTS = {
  summary: 'They shop on Saturdays from a list kept on paper.',
  vision: 'Shopping is the weekly list and the errands around it.',
  vision_why: 'Your first answer: "the weekly shop and nothing else".',
  title: 'Write down how the weekly shop works',
  why: 'You said "the list lives on paper on the fridge" and "I forget what we already have".',
  sections: [
    { heading: 'What it is for', body: 'The weekly shop.' },
    { heading: 'Where things live', body: 'A paper list on the fridge.' },
  ],
  rules: ['Every item on the list says which shop it comes from.'],
};

function interview(module: SpecInterview['module'], extra: Partial<SpecInterview> = {}): SpecInterview {
  return {
    id: 'interview-1',
    module,
    status: 'open',
    questionLimit: 12,
    draftRequestedAt: '2026-10-07T09:30:00Z',
    summary: null,
    visionReviewId: null,
    specChangeId: null,
    startedAt: '2026-10-07T09:00:00Z',
    finishedAt: null,
    turns: [
      { id: 'q1', author: 'claude', body: 'What is it for?', createdAt: '2026-10-07T09:01:00Z' },
      { id: 'a1', author: 'me', body: 'The weekly shop and nothing else.', createdAt: '2026-10-07T09:02:00Z' },
    ],
    ...extra,
  };
}

const deps = (anthropic: Anthropic) => ({ anthropicApiKey: 'k', today: '2026-10-07', anthropic });
const insertOf = (ops: Op[], table: string) =>
  ops.find((op) => op.table === table && op.op === 'insert')?.payload as Record<string, unknown> | undefined;

beforeEach(() => {
  store.finishSpecInterview.mockClear();
});

describe('draftInterview', () => {
  it('drafts a new spec and a first vision for a workspace with neither', async () => {
    store.current = interview('shopping');
    const { client, ops } = fakeClient({ vision: null });
    const model = fakeModel([DRAFTS]);
    const result = await draftInterview(client, 'u1', 'interview-1', deps(model.client));

    expect(result).toEqual({
      kind: 'drafted',
      visionReviewId: 'vision-1',
      specChangeId: 'change-1',
      spec: 'shopping',
      newSpec: true,
      visionHref: '/dev/specs#vision-shopping',
      specChangeHref: '/dev/specs#spec-change-change-1',
      foldedVisionEdit: false,
    });

    const change = insertOf(ops, 'spec_changes')!;
    expect(change).toMatchObject({ user_id: 'u1', spec: 'shopping', made_by: 'claude', title: DRAFTS.title });
    expect(change.why).toBe(`Drafted from your interview about Shopping on 7 October 2026. ${DRAFTS.why}`);
    const applied = applyDiff(change.diff as string, null);
    expect(applied.ok && applied.markdown.startsWith('# Shopping\n')).toBe(true);
    expect(applied.ok && parseRules(applied.markdown).rules.map((r) => r.check)).toEqual([{ kind: 'audit' }]);

    const vision = insertOf(ops, 'vision_reviews')!;
    expect(vision).toMatchObject({
      user_id: 'u1',
      module: 'shopping',
      review_id: 'interview-1',
      outcome: 'edit',
      status: 'pending',
      vision_body: null,
      proposed_body: DRAFTS.vision,
    });
    expect(vision.note).toMatch(/^Drafted from your interview about Shopping on 7 October 2026\. /);

    expect(store.finishSpecInterview).toHaveBeenCalledWith(client, 'u1', 'interview-1', {
      status: 'drafted',
      summary: DRAFTS.summary,
      visionReviewId: 'vision-1',
      specChangeId: 'change-1',
    });
  });

  it("adds to the workspace's spec as it stands in docs/", async () => {
    store.current = interview('todo');
    const { client, ops } = fakeClient({ vision: 'The list I keep.' });
    const result = await draftInterview(client, 'u1', 'interview-1', deps(fakeModel([DRAFTS]).client));
    expect(result).toMatchObject({ kind: 'drafted', spec: 'todo', newSpec: false });

    const change = insertOf(ops, 'spec_changes')!;
    const markdown = readFileSync(join(__dirname, '../../docs/TODO-SPEC.md'), 'utf8');
    const applied = applyDiff(change.diff as string, markdown);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.markdown).toContain('## What it is for\n\nThe weekly shop.');
    expect(parseRules(applied.markdown).rules.at(-1)?.sentence).toBe(DRAFTS.rules[0]);
    expect(insertOf(ops, 'vision_reviews')).toMatchObject({ vision_body: 'The list I keep.' });
  });

  it('lets Dash pick among the specs a workspace has', async () => {
    store.current = interview('learn');
    const { client, ops } = fakeClient({});
    const model = fakeModel([{ ...DRAFTS, spec: 'learn-graph' }]);
    const result = await draftInterview(client, 'u1', 'interview-1', deps(model.client));
    expect(result).toMatchObject({ kind: 'drafted', spec: 'learn-graph' });
    expect(insertOf(ops, 'spec_changes')!.diff).toContain('+++ b/docs/LEARN-GRAPH-SPEC.md');
    const tool = model.sent[0].tools.find((t) => t.name === WRITE_DRAFTS_TOOL)!;
    expect((tool.input_schema.properties.spec as { enum: string[] }).enum).toContain('learn-graph');
  });

  it('gives the app as a whole a spec of its own', async () => {
    store.current = interview('app');
    const { client, ops } = fakeClient({});
    const result = await draftInterview(client, 'u1', 'interview-1', deps(fakeModel([DRAFTS]).client));
    expect(result).toMatchObject({ kind: 'drafted', spec: 'app', newSpec: true, visionHref: '/dev/specs#vision-app' });
    const change = insertOf(ops, 'spec_changes')!;
    expect(change.diff).toContain('+++ b/docs/APP-SPEC.md');
    expect(change.diff).toContain('+# The app as a whole');
    expect(change.why).toMatch(/^Drafted from your interview about the app as a whole on 7 October 2026\./);
  });

  it('folds into an edit the weekly review left waiting rather than stacking a second', async () => {
    store.current = interview('shopping');
    const pending = { id: 'weekly-1', proposed_body: 'Shopping is for the big monthly order.', created_at: '2026-10-04T08:00:00Z' };
    const { client, ops } = fakeClient({ pending });
    const model = fakeModel([DRAFTS]);
    const result = await draftInterview(client, 'u1', 'interview-1', deps(model.client));
    expect(result).toMatchObject({ kind: 'drafted', visionReviewId: 'weekly-1', foldedVisionEdit: true });
    expect(briefOf(model.sent[0])).toContain('Shopping is for the big monthly order.');
    expect(insertOf(ops, 'vision_reviews')).toBeUndefined();
    const update = ops.find((op) => op.table === 'vision_reviews' && op.op === 'update')!;
    expect(update.payload).toMatchObject({ review_id: 'interview-1', proposed_body: DRAFTS.vision });
    expect(update.filters).toContainEqual(['status', 'pending']);
    expect((update.payload as { note: string }).note).toContain('weekly review proposed on 4 October 2026');
  });

  it('asks once more when the spec runs over 60 lines, and keeps the shorter one', async () => {
    store.current = interview('shopping');
    const long = { ...DRAFTS, sections: [{ heading: 'Long', body: Array.from({ length: 70 }, (_, i) => `Line ${i}.`).join('\n') }] };
    const { client, ops } = fakeClient({});
    const model = fakeModel([long, DRAFTS]);
    const result = await draftInterview(client, 'u1', 'interview-1', deps(model.client));
    expect(result.kind).toBe('drafted');
    expect(model.sent).toHaveLength(2);
    expect(briefOf(model.sent[1])).toMatch(/limit is 60/);
    expect(countChangedLines(insertOf(ops, 'spec_changes')!.diff as string)).toBeLessThanOrEqual(60);
  });

  it('drafts nothing before the questions have ended', async () => {
    store.current = interview('shopping', { draftRequestedAt: null });
    const { client, ops } = fakeClient({});
    const result = await draftInterview(client, 'u1', 'interview-1', deps(fakeModel([DRAFTS]).client));
    expect(result).toEqual({ kind: 'stop', move: 'ask' });
    expect(ops.filter((op) => op.op !== 'select')).toEqual([]);
  });

  it('refuses a second new spec while the first is still waiting', async () => {
    store.current = interview('shopping');
    const { client } = fakeClient({ waiting: [{ id: 'change-0' }] });
    const result = await draftInterview(client, 'u1', 'interview-1', deps(fakeModel([DRAFTS]).client));
    expect(result).toMatchObject({ kind: 'failed' });
    expect(store.finishSpecInterview).not.toHaveBeenCalled();
  });

  it('takes the spec change back when the interview was finished meanwhile', async () => {
    store.current = interview('shopping');
    store.finishSpecInterview.mockRejectedValueOnce(new Error('That interview is not one of yours, or it has already finished.'));
    const { client, ops } = fakeClient({});
    const result = await draftInterview(client, 'u1', 'interview-1', deps(fakeModel([DRAFTS]).client));
    expect(result).toMatchObject({ kind: 'failed' });
    expect(ops.some((op) => op.table === 'spec_changes' && op.op === 'delete')).toBe(true);
  });
});
