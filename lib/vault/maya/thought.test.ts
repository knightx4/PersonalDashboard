import { describe, expect, it } from 'vitest';
import type { SpendReport } from '@/lib/core/spend/pricing';
import {
  ESSAY_ACTION,
  ESSAY_ID,
  exampleMaterial,
  INTROSPECTION_ID,
  PASSION_FAKE,
  PASSION_ID,
  SUBJECT_ID,
} from './fixtures/example';
import { readStoredPoints, thoughtBody, thoughtFromMaterial, MAYA_BODY_MAX } from './thought';
import { buildThoughtPrompt, MAX_SEARCHES, MAYA_SYSTEM, THOUGHT_MODEL } from './thought-model';
import { DASH_MODELS } from '@/lib/dash/models';

/**
 * Maya's thought with a fake model client: what is kept of the report once
 * verify.ts has checked it, and how the call is made. The model is not called.
 */

type Reply = { content: unknown[]; stop_reason?: string; usage?: unknown };

function fakeClient(replies: Reply[], calls: Record<string, unknown>[] = []) {
  let index = 0;
  return {
    messages: {
      create: async (body: Record<string, unknown>) => {
        calls.push(structuredClone(body));
        const reply = replies[Math.min(index, replies.length - 1)]!;
        index += 1;
        return { usage: { input_tokens: 20_000, output_tokens: 2_000 }, stop_reason: 'tool_use', ...reply };
      },
    },
  } as unknown as NonNullable<Parameters<typeof thoughtFromMaterial>[1]['client']>;
}

function report(input: unknown, before: unknown[] = []): Reply {
  return { content: [...before, { type: 'tool_use', id: 't1', name: 'report_thought', input }] };
}

// The labels buildThoughtPrompt gives the example: related notes in order.
const N_ESSAY = 'N1';
const N_INTROSPECTION = 'N2';
const N_PASSION = 'N3';

const hesse = {
  author: 'Hermann Hesse',
  work: 'Demian',
  gist: "Each man's life is a road toward himself, walked by living it.",
  exact_text: null,
};

function point(rank: number, extra: Record<string, unknown> = {}) {
  return {
    rank,
    claim: `Claim ${rank}.`,
    argument: `Argument ${rank}.`,
    notes: [{ note: N_ESSAY, quote: ESSAY_ACTION, point: 'Your essay puts action last.' }],
    sources: [],
    ...extra,
  };
}

async function run(input: unknown, searchText: unknown[] = []) {
  const spent: SpendReport[] = [];
  const out = await thoughtFromMaterial(exampleMaterial(), {
    client: fakeClient([report(input, searchText)]),
    onSpend: (r) => spent.push(r),
  });
  if (!out.ok) throw new Error(out.detail);
  return { out, spent };
}

describe('the prompt', () => {
  it('labels the related notes and positions and lists the conflict', () => {
    const { prompt, labels } = buildThoughtPrompt(exampleMaterial());
    expect(labels.notes.get(N_ESSAY)).toBe(ESSAY_ID);
    expect(labels.notes.get(N_INTROSPECTION)).toBe(INTROSPECTION_ID);
    expect(labels.notes.get(N_PASSION)).toBe(PASSION_ID);
    expect([...labels.notes.values()]).not.toContain(SUBJECT_ID);
    expect(labels.positions.get('P1')).toBe('pos-discovered');
    expect(prompt).toContain('THE NOTE: Against "Finding Yourself"');
    expect(prompt).toContain(`[${N_ESSAY}] Life is a road to the self`);
    expect(prompt).toContain('- P1 and P2: Whether the self comes before action.');
    expect(prompt).not.toMatch(/note-road|pos-discovered/);
  });

  it('says there is no conflict when none was found', () => {
    const { prompt } = buildThoughtPrompt(exampleMaterial({ conflicts: [] }));
    expect(prompt).toContain('give no synthesis');
  });

  it('tells Maya to argue a view and not ask questions', () => {
    expect(MAYA_SYSTEM).toContain('Never ask the person to reflect');
    expect(MAYA_SYSTEM).toContain('never ends in a question mark');
  });
});

describe('thoughtFromMaterial', () => {
  it('keeps at most three points, ranked from 1', async () => {
    const { out, spent } = await run({
      question: 'Is the self found before acting, or made by it?',
      points: [point(4), point(2), point(1), point(3)],
    });
    expect(out.thought.points.map((p) => p.claim)).toEqual(['Claim 1.', 'Claim 2.', 'Claim 3.']);
    expect(out.thought.points.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.report.droppedPoints).toBe(1);
    expect(out.points).toHaveLength(3);
    expect(out.model).toBe(THOUGHT_MODEL);
    expect(out.noteBlobSha).toBe('sha-against');
    expect(spent).toEqual([{ model: THOUGHT_MODEL, usage: expect.anything() }]);
  });

  it('drops a quote that is not in the cited note, and a point left with nothing', async () => {
    const { out } = await run({
      question: 'q',
      points: [
        point(1, {
          notes: [
            { note: N_ESSAY, quote: ESSAY_ACTION, point: 'Kept.' },
            // In a different note from the one cited.
            { note: N_INTROSPECTION, quote: PASSION_FAKE, point: 'Dropped.' },
            // Not a label that was given.
            { note: 'N9', quote: ESSAY_ACTION, point: 'Dropped.' },
          ],
        }),
        point(2, { notes: [{ note: N_PASSION, quote: 'words nobody wrote', point: 'Dropped.' }] }),
      ],
    });
    expect(out.thought.points).toHaveLength(1);
    expect(out.thought.points[0]!.notes).toEqual([
      { noteId: ESSAY_ID, title: 'Life is a road to the self', quote: ESSAY_ACTION, point: 'Kept.' },
    ]);
    expect(out.report.droppedQuotes).toBe(3);
    expect(out.report.droppedPoints).toBe(1);
  });

  it('does not count a quote from the note itself as a citation', async () => {
    const { out } = await run({
      question: 'q',
      points: [point(1, { notes: [{ note: 'THIS', quote: 'you become yourself', point: 'Itself.' }] })],
    });
    expect(out.thought.points).toEqual([]);
  });

  it('accepts an empty thought, with an empty body and a question', async () => {
    const { out } = await run({ question: '', points: [] });
    expect(out.thought.points).toEqual([]);
    expect(out.body).toBe('');
    expect(out.points).toEqual([]);
    expect(out.question).toBe('Against "Finding Yourself"');
  });

  it('refuses a synthesis unless its positions were a retrieved conflict', async () => {
    const refused = await run({
      question: 'q',
      points: [point(1)],
      synthesis: { positions: ['P1', 'P3'], resolution: 'Both hold at different times.' },
    });
    expect(refused.out.thought.synthesis).toBeNull();
    expect(refused.out.report.synthesisRefused).toBe(true);

    const same = await run({
      question: 'q',
      points: [point(1)],
      synthesis: { positions: ['P1', 'P1'], resolution: 'One position twice.' },
    });
    expect(same.out.thought.synthesis).toBeNull();

    const kept = await run({
      question: 'q',
      points: [point(1)],
      synthesis: { positions: ['P2', 'P1'], resolution: 'A rough view of yourself steers action, and action revises it.' },
    });
    expect(kept.out.thought.synthesis).toEqual({
      kind: 'synthesis',
      positionIds: ['pos-become', 'pos-discovered'],
      positionNames: ['The self is made in action', 'Action expresses a discovered self'],
      resolution: 'A rough view of yourself steers action, and action revises it.',
    });
    expect(readStoredPoints(kept.out.points).synthesis).toEqual(kept.out.thought.synthesis);
  });

  it('drops a claim that is a question', async () => {
    const { out } = await run({ question: 'q', points: [point(1, { claim: 'Have you tried acting first?' })] });
    expect(out.thought.points).toEqual([]);
  });

  it('keeps a source-only point but ranks own-note points above it', async () => {
    const { out } = await run({
      question: 'q',
      points: [point(1, { notes: [], sources: [hesse] }), point(2)],
    });
    expect(out.thought.points.map((p) => [p.rank, p.notes.length, p.sources.length])).toEqual([
      [1, 1, 0],
      [2, 0, 1],
    ]);
  });

  it('keeps exact words only when the search returned them', async () => {
    const said = 'The call of the self is to become who you are.';
    const cited = {
      type: 'text',
      text: 'Nietzsche puts it this way.',
      citations: [{ type: 'web_search_result_location', cited_text: `Section 270. ${said} And more.`, url: 'u' }],
    };
    const { out } = await run(
      {
        question: 'q',
        points: [
          point(1, {
            sources: [
              { author: 'Friedrich Nietzsche', work: 'The Gay Science', gist: 'Become who you are.', exact_text: said },
              { ...hesse, exact_text: 'A sentence no search returned at all.' },
            ],
          }),
        ],
      },
      [cited],
    );
    const [nietzsche, demian] = out.thought.points[0]!.sources;
    expect(nietzsche!.exactText).toBe(said);
    expect(demian!.exactText).toBeNull();
    expect(demian!.gist).toBe(hesse.gist);
    expect(out.report.paraphrased).toBe(1);
    expect(out.body).toContain(`In their words: "${said}"`);
    expect(out.body).toContain('Hermann Hesse, Demian (paraphrased)');
  });

  it('writes a body that names the notes and fits the column', async () => {
    const { out } = await run({
      question: 'q',
      points: [point(1, { argument: 'x'.repeat(5_000) }), point(2, { argument: 'y'.repeat(5_000) })],
    });
    expect(out.body.length).toBeLessThanOrEqual(MAYA_BODY_MAX);
    expect(out.body.startsWith('1. Claim 1.')).toBe(true);
    expect(thoughtBody(out.thought)).toContain(`From your note "Life is a road to the self": "${ESSAY_ACTION}"`);
  });
});

describe('the call', () => {
  it('lets the model search first and asks for the report after it stops without one', async () => {
    const calls: Record<string, unknown>[] = [];
    const out = await thoughtFromMaterial(exampleMaterial(), {
      client: fakeClient(
        [
          { content: [{ type: 'text', text: 'Thinking aloud.' }], stop_reason: 'end_turn' },
          report({ question: 'q', points: [point(1)] }),
        ],
        calls,
      ),
    });
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // Maya's voice on Dash's loop chooses, so it can search (plan #1479).
    expect(calls[0]!.tool_choice).toEqual({ type: 'auto' });
    expect(calls[0]!.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'web_search_20260209', name: 'web_search' })]),
    );
    // Opus rejects a forced tool, so the ending is asked for rather than forced.
    expect(calls[1]!.tool_choice).toEqual({ type: 'auto' });
    expect(calls[0]!.model).toBe(THOUGHT_MODEL);
    expect(THOUGHT_MODEL).toBe(DASH_MODELS.maya);
  });

  it('caches the system prompt and the material, and allows two searches', async () => {
    const calls: Record<string, unknown>[] = [];
    await thoughtFromMaterial(exampleMaterial(), {
      client: fakeClient([report({ question: 'q', points: [point(1)] })], calls),
    });
    const [call] = calls as { system: unknown[]; messages: { content: unknown }[]; tools: unknown[] }[];
    expect(call!.system[0]).toEqual({ type: 'text', text: MAYA_SYSTEM, cache_control: { type: 'ephemeral' } });
    expect(call!.messages[0]!.content).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ]);
    expect(MAX_SEARCHES).toBe(2);
    expect(call!.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'web_search', max_uses: MAX_SEARCHES })]),
    );
  });

  it('sends a paused turn back as it is', async () => {
    const calls: Record<string, unknown>[] = [];
    await thoughtFromMaterial(exampleMaterial(), {
      client: fakeClient(
        [{ content: [{ type: 'server_tool_use', id: 's1', name: 'web_search' }], stop_reason: 'pause_turn' }, report({ question: 'q', points: [] })],
        calls,
      ),
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.tool_choice).toEqual({ type: 'auto' });
    expect((calls[1]!.messages as unknown[]).length).toBe(2);
  });

  it('never throws: a failed call, a cut-off reply and no key all come back as failures', async () => {
    const failing = {
      messages: {
        create: async () => {
          throw new Error('down');
        },
      },
    } as unknown as NonNullable<Parameters<typeof thoughtFromMaterial>[1]['client']>;
    expect(await thoughtFromMaterial(exampleMaterial(), { client: failing })).toEqual({
      ok: false,
      reason: 'error',
      detail: 'down',
    });
    const cut = await thoughtFromMaterial(exampleMaterial(), {
      client: fakeClient([{ content: [], stop_reason: 'max_tokens' }]),
    });
    expect(cut).toMatchObject({ ok: false, reason: 'error' });
    expect(await thoughtFromMaterial(exampleMaterial(), {})).toMatchObject({ ok: false, reason: 'no-key' });
  });
});
