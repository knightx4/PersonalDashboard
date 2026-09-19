import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { NearbySegment } from '@/lib/learn/catalogue/nearest';
import {
  anthropicJudge,
  judgeCandidates,
  tableLinkStore,
  JUDGE_MODEL,
  type JudgeVerdict,
  type LinkStore,
  type LinkTarget,
  type SegmentJudge,
} from '@/lib/learn/catalogue/judge';

/**
 * What this pass promises.
 *
 * Three of these are the step's own acceptance: a match is stored with the
 * sentence and the model that wrote it, a candidate the model refuses is not
 * stored at all, and running the pass twice does not duplicate anything. The
 * rest are the failures that would otherwise be found in production -- a reply
 * that said yes without saying why, and one candidate's call taking the other
 * thirty-nine with it.
 *
 * No database. The store is in memory for the pass tests, and the live store
 * is tested separately against a client that records the statements it was
 * given, which is the part of it worth holding still: the target column, the
 * confidence, and what it does with a unique violation.
 */

const CONCEPT: LinkTarget = { concept: 'concept-1' };

function segment(id: string, overrides: Partial<NearbySegment> = {}): NearbySegment {
  return {
    segmentId: id,
    itemId: 'item-1',
    ordinal: 0,
    heading: 'A section',
    sectionAnchor: 'a-section',
    tStartSeconds: null,
    tEndSeconds: null,
    text: 'The text of the section, long enough to be worth reading.',
    embeddingModel: 'voyage-4-lite',
    similarity: 0.8,
    item: { title: 'An article', kind: 'article', canonicalUrl: 'https://example.invalid/a' },
    ...overrides,
  };
}

/** A links table in memory, with the unique index the real one has. */
function memoryStore(): LinkStore & { rows: { key: string; basis: string; model: string }[] } {
  const rows: { key: string; basis: string; model: string }[] = [];
  const keyFor = (target: LinkTarget, segmentId: string) =>
    `${target.concept ?? target.subject}|${segmentId}`;

  return {
    rows,
    async linked({ target, segmentIds }) {
      return segmentIds.filter((id) => rows.some((row) => row.key === keyFor(target, id)));
    },
    async write({ target, link }) {
      const key = keyFor(target, link.segmentId);
      if (rows.some((row) => row.key === key)) return false;
      rows.push({ key, basis: link.basis, model: link.model });
      return true;
    },
  };
}

/** A judge that answers from a lookup, and counts what it was asked. */
function scriptedJudge(
  verdicts: Record<string, JudgeVerdict>,
): SegmentJudge & { asked: string[] } {
  const asked: string[] = [];
  const judge: SegmentJudge = async ({ segment: candidate }) => {
    asked.push(candidate.segmentId);
    return verdicts[candidate.segmentId] ?? { outcome: 'refused', detail: 'Not about it.' };
  };
  return Object.assign(judge, { asked });
}

describe('judging the candidates', () => {
  it('stores a match with the sentence that justified it and the model that judged it', async () => {
    const store = memoryStore();
    const judge = scriptedJudge({
      'segment-a': { outcome: 'teaches', basis: 'Derives the result and says where it fails.' },
    });

    const result = await judgeCandidates(
      { judge, store },
      { claim: 'Inflation expectations shift the short-run curve.', segments: [segment('segment-a')], target: CONCEPT },
    );

    expect(result.written).toEqual([
      {
        segmentId: 'segment-a',
        basis: 'Derives the result and says where it fails.',
        model: JUDGE_MODEL,
      },
    ]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].model).toBe(JUDGE_MODEL);
  });

  it('stores nothing for a candidate the model will not argue for', async () => {
    const store = memoryStore();
    const judge = scriptedJudge({
      'segment-a': { outcome: 'refused', detail: 'Same subject, different point.' },
      'segment-b': { outcome: 'teaches', basis: 'Works an example of it.' },
    });

    const result = await judgeCandidates(
      { judge, store },
      { claim: 'A claim.', segments: [segment('segment-a'), segment('segment-b')], target: CONCEPT },
    );

    expect(result.judged).toBe(2);
    expect(result.refused).toBe(1);
    expect(result.written.map((link) => link.segmentId)).toEqual(['segment-b']);
    expect(store.rows).toHaveLength(1);
  });

  it('writes nothing and makes no call the second time round', async () => {
    const store = memoryStore();
    const verdicts: Record<string, JudgeVerdict> = {
      'segment-a': { outcome: 'teaches', basis: 'States it and says why it holds.' },
    };
    const segments = [segment('segment-a'), segment('segment-b')];

    const first = await judgeCandidates(
      { judge: scriptedJudge(verdicts), store },
      { claim: 'A claim.', segments, target: CONCEPT },
    );
    expect(first.written).toHaveLength(1);

    const again = scriptedJudge(verdicts);
    const second = await judgeCandidates(
      { judge: again, store },
      { claim: 'A claim.', segments, target: CONCEPT },
    );

    expect(store.rows).toHaveLength(1);
    expect(second.written).toEqual([]);
    expect(second.skipped).toBe(1);
    // The refused one has left no trace, so it is judged again; the linked one
    // never reaches the model, which is what makes the repeat press cheap.
    expect(again.asked).toEqual(['segment-b']);
  });

  it('counts a link another press won the race for instead of duplicating it', async () => {
    const store = memoryStore();
    // Already there, and `linked` does not know it: the other press inserted
    // between this pass's read and its write.
    const racing: LinkStore = { ...store, linked: async () => [] };

    const result = await judgeCandidates(
      { judge: scriptedJudge({ 'segment-a': { outcome: 'teaches', basis: 'Explains it.' } }), store: racing },
      { claim: 'A claim.', segments: [segment('segment-a')], target: CONCEPT },
    );
    expect(result.written).toHaveLength(1);

    const second = await judgeCandidates(
      { judge: scriptedJudge({ 'segment-a': { outcome: 'teaches', basis: 'Explains it.' } }), store: racing },
      { claim: 'A claim.', segments: [segment('segment-a')], target: CONCEPT },
    );

    expect(second.raced).toBe(1);
    expect(second.written).toEqual([]);
    expect(store.rows).toHaveLength(1);
  });

  it('keeps going when one call fails', async () => {
    const store = memoryStore();
    const judge = scriptedJudge({
      'segment-a': { outcome: 'failed', detail: 'The reply was cut off.' },
      'segment-b': { outcome: 'teaches', basis: 'Argues the case against it.' },
    });

    const result = await judgeCandidates(
      { judge, store },
      { claim: 'A claim.', segments: [segment('segment-a'), segment('segment-b')], target: CONCEPT },
      { concurrency: 1 },
    );

    expect(result.failed).toEqual([{ segmentId: 'segment-a', detail: 'The reply was cut off.' }]);
    expect(result.written.map((link) => link.segmentId)).toEqual(['segment-b']);
  });

  it('judges no more candidates than it was told it could', async () => {
    const store = memoryStore();
    const judge = scriptedJudge({});

    const result = await judgeCandidates(
      { judge, store },
      {
        claim: 'A claim.',
        segments: [segment('segment-a'), segment('segment-b'), segment('segment-c')],
        target: CONCEPT,
      },
      { maxCandidates: 2 },
    );

    expect(judge.asked).toEqual(['segment-a', 'segment-b']);
    expect(result.judged).toBe(2);
  });

  it('makes no call at all when retrieval found nothing', async () => {
    const store = memoryStore();
    const judge = scriptedJudge({});

    const result = await judgeCandidates(
      { judge, store },
      { claim: 'A claim.', segments: [], target: CONCEPT },
    );

    expect(judge.asked).toEqual([]);
    expect(result).toEqual({ written: [], judged: 0, refused: 0, skipped: 0, raced: 0, failed: [] });
  });
});

/** A reply as the SDK returns it, with one tool block. */
function reply(input: Record<string, unknown>) {
  return {
    content: [{ type: 'tool_use', name: 'report_verdict', input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 800, output_tokens: 40 },
  };
}

function fakeAnthropic(response: unknown): Anthropic {
  return { messages: { create: vi.fn(async () => response) } } as unknown as Anthropic;
}

describe('the live judge', () => {
  it('takes a yes with its sentence, and reports what the call cost', async () => {
    const spent: { model: string }[] = [];
    const judge = anthropicJudge({
      client: fakeAnthropic(reply({ teaches: true, basis: '  Derives it from the budget constraint.  ' })),
      onSpend: (report) => spent.push(report),
    });

    await expect(judge({ claim: 'A claim.', concept: 'A concept', segment: segment('segment-a') })).resolves.toEqual({
      outcome: 'teaches',
      basis: 'Derives it from the budget constraint.',
    });
    expect(spent.map((report) => report.model)).toEqual([JUDGE_MODEL]);
  });

  it('reads a no as a refusal, which is the ordinary outcome', async () => {
    const judge = anthropicJudge({
      client: fakeAnthropic(reply({ teaches: false, reason: 'Mentions it in passing.' })),
    });

    await expect(judge({ claim: 'A claim.', concept: null, segment: segment('segment-a') })).resolves.toEqual({
      outcome: 'refused',
      detail: 'Mentions it in passing.',
    });
  });

  it('refuses to invent a basis for a yes that came with none', async () => {
    const judge = anthropicJudge({ client: fakeAnthropic(reply({ teaches: true, basis: '   ' })) });

    const verdict = await judge({ claim: 'A claim.', concept: null, segment: segment('segment-a') });
    expect(verdict.outcome).toBe('failed');
  });

  it('fails rather than throwing when the call does', async () => {
    const judge = anthropicJudge({
      client: {
        messages: {
          create: vi.fn(async () => {
            throw new Error('rate limited');
          }),
        },
      } as unknown as Anthropic,
    });

    await expect(judge({ claim: 'A claim.', concept: null, segment: segment('segment-a') })).resolves.toEqual({
      outcome: 'failed',
      detail: 'rate limited',
    });
  });

  it('says why when the reply carried no verdict', async () => {
    const judge = anthropicJudge({
      client: fakeAnthropic({
        content: [{ type: 'text', text: 'I think so.' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
    });

    const verdict = await judge({ claim: 'A claim.', concept: null, segment: segment('segment-a') });
    expect(verdict.outcome).toBe('failed');
    expect(verdict.outcome === 'failed' && verdict.detail).toContain('cut off');
  });
});

/** A client that records the statements it was handed. */
function recordingClient(options: { existing?: string[]; insertError?: { code: string; message: string } }) {
  const inserted: Record<string, unknown>[] = [];
  const filters: [string, unknown][] = [];

  const client = {
    from(table: string) {
      expect(table).toBe('catalogue_links');
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return this;
            },
            async in(column: string, values: string[]) {
              filters.push([column, values]);
              return {
                data: (options.existing ?? []).map((id) => ({ segment_id: id })),
                error: null,
              };
            },
          };
        },
        async insert(row: Record<string, unknown>) {
          inserted.push(row);
          return { error: options.insertError ?? null };
        },
      };
    },
  };

  return { client: client as unknown as LearnSupabaseClient, inserted, filters };
}

describe('the live store', () => {
  it('writes a link at verified, against the concept column', async () => {
    const { client, inserted } = recordingClient({});
    const store = tableLinkStore(client, 'user-1');

    await expect(
      store.write({ target: CONCEPT, link: { segmentId: 'segment-a', basis: 'Explains it.', model: JUDGE_MODEL } }),
    ).resolves.toBe(true);

    expect(inserted).toEqual([
      {
        user_id: 'user-1',
        segment_id: 'segment-a',
        concept_id: 'concept-1',
        basis: 'Explains it.',
        confidence: 'verified',
        model: JUDGE_MODEL,
      },
    ]);
  });

  it('writes a subject link against the subject column instead', async () => {
    const { client, inserted } = recordingClient({});
    const store = tableLinkStore(client, 'user-1');

    await store.write({
      target: { subject: 'subject-1' },
      link: { segmentId: 'segment-a', basis: 'Covers the area.', model: JUDGE_MODEL },
    });

    expect(inserted[0]).toMatchObject({ subject_id: 'subject-1' });
    expect(inserted[0]).not.toHaveProperty('concept_id');
  });

  it('reads a unique violation as the link already being there', async () => {
    const { client } = recordingClient({
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    await expect(
      tableLinkStore(client, 'user-1').write({
        target: CONCEPT,
        link: { segmentId: 'segment-a', basis: 'Explains it.', model: JUDGE_MODEL },
      }),
    ).resolves.toBe(false);
  });

  it('raises anything else the insert said', async () => {
    const { client } = recordingClient({
      insertError: { code: '42501', message: 'new row violates row-level security policy' },
    });

    await expect(
      tableLinkStore(client, 'user-1').write({
        target: CONCEPT,
        link: { segmentId: 'segment-a', basis: 'Explains it.', model: JUDGE_MODEL },
      }),
    ).rejects.toThrow('row-level security');
  });

  it('asks for nothing when there are no candidates to ask about', async () => {
    const { client, filters } = recordingClient({ existing: ['segment-a'] });

    await expect(
      tableLinkStore(client, 'user-1').linked({ target: CONCEPT, segmentIds: [] }),
    ).resolves.toEqual([]);
    expect(filters).toEqual([]);
  });

  it('returns the segments already linked, scoped to the account and the target', async () => {
    const { client, filters } = recordingClient({ existing: ['segment-a'] });

    await expect(
      tableLinkStore(client, 'user-1').linked({ target: CONCEPT, segmentIds: ['segment-a', 'segment-b'] }),
    ).resolves.toEqual(['segment-a']);

    expect(filters).toEqual([
      ['user_id', 'user-1'],
      ['concept_id', 'concept-1'],
      ['segment_id', ['segment-a', 'segment-b']],
    ]);
  });
});
