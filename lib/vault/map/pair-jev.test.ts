import { describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE, type SpendReport } from '@/lib/core/spend/pricing';
import type { JevChoiceAnswer } from '@/lib/jev/client';
import {
  judgeLinksWithJev,
  linkRecordRow,
  type LinkJudgeOutcome,
  type LinkPair,
} from '@/lib/vault/map/link-positions';
import {
  judgeWithJev,
  proposalRow,
  runMergePass,
  sumByModel,
  type JudgeOutcome,
  type MergePair,
  type MergeProposalRow,
} from '@/lib/vault/map/merge-pass';
import {
  jevMergeReason,
  LINK_QUESTION,
  linkLabelMeaning,
  readLinkAnswer,
  readMergeAnswer,
  THEME_MERGE_QUESTION,
  themeMergeState,
  type LinkLabel,
  type MergeLabel,
} from '@/lib/vault/map/pair-jev-question';

/** Jev answering each pair from the state it was sent: side A's name picks the probabilities. */
function jevSays(byName: Record<string, Record<string, number>>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as { state: { A: { name: string } } };
    const probabilities = byName[sent.state.A.name];
    if (!probabilities) return new Response('overloaded', { status: 529 });
    const [choice, confidence] = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0];
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: { answer: { type: 'choice', choice, confidence, probabilities } },
        usage: { input_tokens: 400, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
}

function choice<L extends string>(probabilities: Record<L, number>): JevChoiceAnswer<L> {
  const [top, confidence] = (Object.entries(probabilities) as [L, number][]).sort(
    (x, y) => y[1] - x[1],
  )[0];
  return { type: 'choice', choice: top, confidence, probabilities };
}

function themePair(
  a: string,
  b: string,
  aNotes = 1,
  bNotes = 1,
): MergePair<{ id: string; name: string; about: string; notes: number }> {
  return {
    userId: 'user-1',
    a: { id: a, name: a, about: `what ${a} covers`, notes: aNotes },
    b: { id: b, name: b, about: `what ${b} covers`, notes: bNotes },
    similarity: 0.8,
    trigram: null,
  };
}

function linkPair(a: string, b: string): LinkPair {
  return {
    userId: 'user-1',
    a: { id: a, name: a, statement: `${a} holds.`, kind: 'claim' },
    b: { id: b, name: b, statement: `${b} holds.`, kind: 'claim' },
    similarity: 0.7,
  };
}

describe('readMergeAnswer', () => {
  it('calls a pair the same when the two same options together outweigh different', () => {
    expect(
      readMergeAnswer(choice<MergeLabel>({ different: 0.4, same_keep_a: 0.35, same_keep_b: 0.25 })),
    ).toEqual({
      same: true,
      keep: 'A',
      confidence: 0.6,
    });
  });

  it('keeps B’s name when B is the likelier and reads different with its own probability', () => {
    expect(
      readMergeAnswer(choice<MergeLabel>({ different: 0.1, same_keep_a: 0.2, same_keep_b: 0.7 }))
        .keep,
    ).toBe('B');
    expect(
      readMergeAnswer(choice<MergeLabel>({ different: 0.85, same_keep_a: 0.1, same_keep_b: 0.05 })),
    ).toEqual({
      same: false,
      keep: null,
      confidence: 0.85,
    });
  });

  it('writes a reason that says what was judged and how sure', () => {
    expect(jevMergeReason('theme', { same: true, keep: 'A', confidence: 0.914 })).toBe(
      'Judged one subject under two names, 91% sure.',
    );
    expect(jevMergeReason('position', { same: false, keep: null, confidence: 0.6 })).toBe(
      'Judged two positions, 60% sure.',
    );
  });
});

describe('LINK_QUESTION and readLinkAnswer', () => {
  it('offers none, the two symmetric types and each directed type both ways', () => {
    expect(Object.keys(LINK_QUESTION.options)).toHaveLength(11);
    expect(linkLabelMeaning('b_example_of_a')).toEqual({ relation: 'example_of', from: 'B' });
    expect(linkLabelMeaning('a_supports_b')).toEqual({ relation: 'supports', from: 'A' });
    expect(linkLabelMeaning('contradicts')).toEqual({ relation: 'contradicts', from: 'A' });
    expect(LINK_QUESTION.options.a_supports_b).toBe(
      'B is true partly because A is: A is part of why B holds.',
    );
  });

  it('sums a relation over its two directions and runs it from the likelier side', () => {
    const answer = choice<LinkLabel>({
      none: 0.4,
      a_supports_b: 0.25,
      b_supports_a: 0.3,
      contradicts: 0.05,
    } as Record<LinkLabel, number>);
    expect(readLinkAnswer(answer)).toEqual({ relation: 'supports', from: 'B', confidence: 0.55 });
  });

  it('reads none with no direction', () => {
    const answer = choice<LinkLabel>({ none: 0.9, same_as: 0.1 } as Record<LinkLabel, number>);
    expect(readLinkAnswer(answer)).toEqual({ relation: 'none', from: null, confidence: 0.9 });
  });
});

describe('judgeWithJev', () => {
  const haikuVerdicts = (batch: unknown[]): JudgeOutcome => ({
    ok: true,
    model: 'claude-haiku-4-5',
    verdicts: batch.map((_, index) => ({
      pair: index,
      same: false,
      name: null,
      reason: 'Two subjects.',
      confidence: 0.7,
    })),
  });

  function judge(opts: {
    jev: typeof fetch;
    enabled?: boolean;
    floor?: number;
    haiku?: (b: unknown[]) => JudgeOutcome;
  }) {
    const pairs = [
      themePair('Housing', 'Homes', 1, 3),
      themePair('Monetary', 'Fiscal'),
      themePair('Down', 'Other'),
    ];
    const spend: SpendReport[] = [];
    const haiku = vi.fn(async (batch: typeof pairs, onSpend: (r: SpendReport) => void) => {
      onSpend({
        model: 'claude-haiku-4-5',
        usage: { ...EMPTY_USAGE, inputTokens: 600, outputTokens: 90 },
      });
      return (opts.haiku ?? haikuVerdicts)(batch);
    });
    const run = judgeWithJev({
      kind: 'theme',
      pairs,
      question: THEME_MERGE_QUESTION,
      state: themeMergeState,
      haiku,
      onSpend: (r) => spend.push(r),
      enabled: opts.enabled ?? true,
      floor: opts.floor,
      jevApiKey: 'test-key',
      jevFetch: opts.jev,
    });
    return { run, haiku, spend, pairs };
  }

  const jev = jevSays({
    Housing: { different: 0.1, same_keep_a: 0.2, same_keep_b: 0.7 },
    Monetary: { different: 0.55, same_keep_a: 0.3, same_keep_b: 0.15 },
  });

  it('writes Jev’s answer at any confidence and sends only the pair Jev failed on to Haiku', async () => {
    const { run, haiku, spend, pairs } = judge({ jev });
    const outcome = await run;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(haiku).toHaveBeenCalledTimes(1);
    expect(haiku.mock.calls[0][0].map((p) => p.a.name)).toEqual(['Down']);

    const byName = Object.fromEntries(outcome.verdicts.map((v) => [pairs[v.pair].a.name, v]));
    expect(byName.Housing).toMatchObject({
      same: true,
      name: 'Homes',
      confidence: 0.9,
      model: 'jev-1.13.0',
    });
    expect(byName.Housing.reason).toBe('Judged one subject under two names, 90% sure.');
    expect(byName.Monetary).toMatchObject({
      same: false,
      name: null,
      confidence: 0.55,
      model: 'jev-1.13.0',
    });
    expect(byName.Down).toMatchObject({
      same: false,
      reason: 'Two subjects.',
      model: 'claude-haiku-4-5',
    });

    // The proposal keeps the side whose name Jev chose.
    const row = proposalRow('theme', pairs[byName.Housing.pair], byName.Housing, outcome.model);
    expect(row).toMatchObject({ survivor_name: 'Homes', model: 'jev-1.13.0', verdict: 'same' });

    expect(sumByModel(spend)).toEqual([
      { model: 'jev-1.13.0', usage: { ...EMPTY_USAGE, inputTokens: 800 } },
      { model: 'claude-haiku-4-5', usage: { ...EMPTY_USAGE, inputTokens: 600, outputTokens: 90 } },
    ]);
  });

  it('sends Jev’s less sure answers to Haiku when a floor is set', async () => {
    const { run, haiku } = judge({ jev, floor: 0.8 });
    await run;
    expect(haiku.mock.calls[0][0].map((p) => p.a.name)).toEqual(['Monetary', 'Down']);
  });

  it('asks Jev nothing for an account that has not opted in', async () => {
    const quiet = jevSays({});
    const { run, haiku } = judge({ jev: quiet, enabled: false });
    await run;
    expect(quiet).not.toHaveBeenCalled();
    expect(haiku.mock.calls[0][0]).toHaveLength(3);
  });

  it('keeps Jev’s answers and stops when the Haiku call for the rest fails', async () => {
    const { run } = judge({
      jev,
      haiku: () => ({ ok: false, reason: 'failed', detail: 'no credit' }),
    });
    const outcome = await run;
    expect(outcome).toMatchObject({ ok: true, stopped: { reason: 'failed', detail: 'no credit' } });
    if (outcome.ok) expect(outcome.verdicts).toHaveLength(2);
  });
});

describe('runMergePass with a partial outcome', () => {
  it('writes what was judged, then stops', async () => {
    const stored: MergeProposalRow[] = [];
    const result = await runMergePass('theme', {
      candidates: async () => [themePair('a', 'b'), themePair('c', 'd')],
      judge: async () => ({
        ok: true,
        model: 'jev-1.13.0',
        verdicts: [
          {
            pair: 0,
            same: false,
            name: null,
            reason: 'Judged two subjects, 90% sure.',
            confidence: 0.9,
          },
        ],
        stopped: { reason: 'failed', detail: 'no credit' },
      }),
      store: async (rows) => (stored.push(...rows), rows.length),
    });
    expect(stored).toHaveLength(1);
    expect(result).toMatchObject({ proposed: 1, calls: 1, stopped: { reason: 'failed' } });
  });
});

describe('judgeLinksWithJev', () => {
  it('records Jev’s relation with no reason and sends the pair Jev failed on to Haiku', async () => {
    const pairs = [linkPair('Walkable', 'Transit'), linkPair('Down', 'Other')];
    const jev = jevSays({
      Walkable: { none: 0.3, a_qualifies_b: 0.1, b_qualifies_a: 0.6 },
    });
    const haiku = vi.fn(
      async (batch: LinkPair[]): Promise<LinkJudgeOutcome> => ({
        ok: true,
        model: 'claude-haiku-4-5',
        verdicts: batch.map((_, index) => ({
          pair: index,
          relation: 'none',
          from: null,
          reason: 'Only the subject is shared.',
          confidence: 0.7,
        })),
      }),
    );
    const outcome = await judgeLinksWithJev({
      pairs,
      haiku,
      onSpend: () => {},
      enabled: true,
      jevApiKey: 'test-key',
      jevFetch: jev,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(haiku.mock.calls[0][0].map((p) => p.a.name)).toEqual(['Down']);

    const [first, second] = outcome.verdicts;
    expect(first).toEqual({
      pair: 0,
      relation: 'qualifies',
      from: 'B',
      reason: null,
      confidence: 0.7,
      model: 'jev-1.13.0',
    });
    expect(linkRecordRow(pairs[0], first, outcome.model)).toMatchObject({
      relation: 'qualifies',
      from_id: 'Transit',
      reason: null,
      model: 'jev-1.13.0',
    });
    expect(second).toMatchObject({ pair: 1, relation: 'none', model: 'claude-haiku-4-5' });
  });
});
