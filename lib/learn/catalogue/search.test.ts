import { describe, expect, it, vi } from 'vitest';
import { EMPTY_USAGE } from '@/lib/core/spend/pricing';
import { JUDGE_MODEL, type JudgePassResult } from '@/lib/learn/catalogue/judge';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { NearbySegment, NearestOutcome } from '@/lib/learn/catalogue/nearest';
import {
  recordJudgements,
  runCatalogueSearch,
  runCatalogueSearchIfNew,
  searchCompleted,
  type CatalogueMiss,
  type CatalogueSearchPorts,
  type CatalogueSearchResult,
} from '@/lib/learn/catalogue/search';

/**
 * What the press promises before it goes to the web.
 *
 * Two of these are the step's own acceptance: a claim the catalogue covers
 * comes back covered, so the press stays on the claim, and every other outcome
 * comes back as a miss, so the press queues the reading and runs the web
 * search exactly as it did before. The rest are the ways of coming up empty
 * that would otherwise be found in production -- no key, a provider that would
 * not answer, a judging pass that threw rather than refusing -- each of which
 * has to be the same answer to the caller and a different `missed` in a log.
 *
 * No network and no database. Both outside calls are ports, the same as the
 * modules below this.
 */

function segment(id: string): NearbySegment {
  return {
    segmentId: id,
    itemId: 'item-1',
    ordinal: 0,
    heading: 'A section',
    sectionAnchor: 'a-section',
    tStartSeconds: null,
    tEndSeconds: null,
    text: 'The text of the section.',
    embeddingModel: 'voyage-4-lite',
    similarity: 0.8,
    item: { title: 'An article', kind: 'article', canonicalUrl: 'https://example.invalid/a' },
  };
}

function found(segments: NearbySegment[]): NearestOutcome {
  return {
    ok: true,
    segments,
    model: 'voyage-4-lite',
    models: ['voyage-4-lite'],
    tokens: 12,
  };
}

function pass(overrides: Partial<JudgePassResult> = {}): JudgePassResult {
  return {
    written: [],
    judgements: [],
    judged: 0,
    refused: 0,
    skipped: 0,
    raced: 0,
    failed: [],
    ...overrides,
  };
}

const LINK = { segmentId: 'segment-1', basis: 'It works the example through.', model: 'x' };

type Recorded = Parameters<CatalogueSearchPorts['record']>[0];

/** Ports that spend on both calls, so the split of the ledger is visible. */
function ports(
  retrieve: NearestOutcome | (() => Promise<NearestOutcome>),
  judge: JudgePassResult | (() => Promise<JudgePassResult>),
): CatalogueSearchPorts & { judged: number; recorded: Recorded[] } {
  const state = { judged: 0 };
  const recorded: Recorded[] = [];

  return {
    recorded,
    get judged() {
      return state.judged;
    },
    async record(input) {
      recorded.push(input);
    },
    async retrieve({ onSpend }) {
      onSpend({ model: 'voyage-4-lite', usage: { ...EMPTY_USAGE, inputTokens: 12 } });
      return typeof retrieve === 'function' ? retrieve() : retrieve;
    },
    async judge({ onSpend }) {
      state.judged += 1;
      onSpend({ model: 'claude-haiku-4-5', usage: { ...EMPTY_USAGE, inputTokens: 900 } });
      return typeof judge === 'function' ? judge() : judge;
    },
  };
}

const CLAIM = {
  claim: 'A moving charge produces a magnetic field.',
  concept: 'Magnetic field of a current',
  target: { concept: 'concept-1' } as const,
};

async function search(
  retrieve: NearestOutcome | (() => Promise<NearestOutcome>),
  judge: JudgePassResult | (() => Promise<JudgePassResult>),
): Promise<{ result: CatalogueSearchResult; judged: number }> {
  const port = ports(retrieve, judge);
  const result = await runCatalogueSearch(port, CLAIM);
  return { result, judged: port.judged };
}

describe('runCatalogueSearch', () => {
  it('reports a claim the catalogue covers, with what the press wrote', async () => {
    const { result } = await search(found([segment('segment-1')]), pass({ written: [LINK], judged: 1 }));

    expect(result.covered).toBe(true);
    expect(result.missed).toBeNull();
    expect(result.written).toBe(1);
    expect(result.considered).toBe(1);
  });

  it('splits what it spent, so the two calls land in the ledger separately', async () => {
    const { result } = await search(found([segment('segment-1')]), pass({ written: [LINK], judged: 1 }));

    expect(result.embedSpend.map((report) => report.model)).toEqual(['voyage-4-lite']);
    expect(result.judgeSpend.map((report) => report.model)).toEqual(['claude-haiku-4-5']);
  });

  it('counts a claim whose links were already there as covered', async () => {
    // The repeat press. Nothing is written and no call is made for a candidate
    // already linked, and the press still has to stay on the claim rather than
    // queue a second reading of it.
    const { result } = await search(found([segment('segment-1')]), pass({ skipped: 1 }));

    expect(result.covered).toBe(true);
    expect(result.written).toBe(0);
    expect(result.already).toBe(1);
  });

  it('counts a link written between the skip check and the insert as covered', async () => {
    const { result } = await search(found([segment('segment-1')]), pass({ raced: 1, judged: 1 }));

    expect(result.covered).toBe(true);
    expect(result.already).toBe(1);
  });

  it('misses when nothing in the catalogue is close, without a judging call', async () => {
    const { result, judged } = await search(found([]), pass());

    expect(result.covered).toBe(false);
    expect(result.missed).toBe('nothing-near');
    expect(judged).toBe(0);
    // The claim was embedded to find that out, and that is what it cost.
    expect(result.embedSpend).toHaveLength(1);
    expect(result.judgeSpend).toEqual([]);
  });

  it('misses when every candidate is refused, and still reports the calls', async () => {
    const { result } = await search(
      found([segment('segment-1'), segment('segment-2')]),
      pass({ judged: 2, refused: 2 }),
    );

    expect(result.covered).toBe(false);
    expect(result.missed).toBe('nothing-taught');
    expect(result.considered).toBe(2);
    expect(result.judgeSpend).toHaveLength(1);
  });

  it('misses without embedding when retrieval refuses, and says which refusal', async () => {
    const { result, judged } = await search(
      { ok: false, reason: 'no-key', detail: 'EMBEDDING_API_KEY is not set', tokens: 0 },
      pass(),
    );

    expect(result.covered).toBe(false);
    expect(result.missed).toBe('no-key');
    expect(result.detail).toBe('EMBEDDING_API_KEY is not set');
    expect(judged).toBe(0);
  });

  it('misses rather than throwing when the judging pass fails', async () => {
    const { result } = await search(found([segment('segment-1')]), () => {
      throw new Error('links table refused the write');
    });

    expect(result.covered).toBe(false);
    expect(result.missed).toBe('judge-failed');
    expect(result.detail).toBe('links table refused the write');
    // The press has somewhere else to go, so what was spent getting here still
    // has to reach the ledger.
    expect(result.embedSpend).toHaveLength(1);
    expect(result.judgeSpend).toHaveLength(1);
  });

  it('counts candidates that produced no verdict without calling them refusals', async () => {
    const { result } = await search(
      found([segment('segment-1'), segment('segment-2')]),
      pass({ written: [LINK], judged: 2, failed: [{ segmentId: 'segment-2', detail: 'timeout' }] }),
    );

    expect(result.covered).toBe(true);
    expect(result.failed).toBe(1);
  });

  it('passes the claim and the concept it belongs to through to the judge', async () => {
    let seen: { claim: string; concept?: string | null } | null = null;
    const port: CatalogueSearchPorts = {
      async retrieve() {
        return found([segment('segment-1')]);
      },
      async judge(input) {
        seen = { claim: input.claim, concept: input.concept };
        return pass({ written: [LINK], judged: 1 });
      },
      async record() {},
    };

    await runCatalogueSearch(port, CLAIM);

    expect(seen).toEqual({ claim: CLAIM.claim, concept: CLAIM.concept });
  });
});

/**
 * What the press keeps of the judging, for the section trial (#766).
 *
 * The acceptance is that a press with candidates above the floor leaves one
 * row per judged segment, refusals included, and that a skipped press leaves
 * none. The skip half is in the repeat-press block below.
 */
describe('recording what the judge said', () => {
  const JUDGEMENTS = [
    { segmentId: 'segment-1', similarity: 0.8, chars: 900, verdict: 'accepted' as const },
    { segmentId: 'segment-2', similarity: 0.7, chars: 200, verdict: 'refused' as const },
  ];

  it('records every judged candidate against the claim, stamped with the press', async () => {
    const pressedAt = new Date('2026-09-22T12:00:00.000Z');
    const port = ports(
      found([segment('segment-1'), segment('segment-2')]),
      pass({ written: [LINK], judged: 2, refused: 1, judgements: JUDGEMENTS }),
    );

    await runCatalogueSearch(port, { ...CLAIM, pressedAt });

    expect(port.recorded).toEqual([
      { target: CLAIM.target, judgements: JUDGEMENTS, pressedAt },
    ]);
  });

  it('records a press whose every candidate was refused', async () => {
    const refusals = JUDGEMENTS.map((j) => ({ ...j, verdict: 'refused' as const }));
    const port = ports(
      found([segment('segment-1'), segment('segment-2')]),
      pass({ judged: 2, refused: 2, judgements: refusals }),
    );

    const result = await runCatalogueSearch(port, CLAIM);

    expect(result.missed).toBe('nothing-taught');
    expect(port.recorded[0].judgements).toEqual(refusals);
  });

  it('records nothing when nothing was close enough to judge', async () => {
    const port = ports(found([]), pass());

    await runCatalogueSearch(port, CLAIM);

    expect(port.recorded).toEqual([]);
  });

  it('still answers the press when the record cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const port: CatalogueSearchPorts = {
      ...ports(found([segment('segment-1')]), pass({ written: [LINK], judged: 1, judgements: JUDGEMENTS })),
      async record() {
        throw new Error('permission denied');
      },
    };

    const result = await runCatalogueSearch(port, CLAIM);

    expect(result.covered).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the live judgements writer', () => {
  function recordingClient(error: { message: string } | null = null) {
    const inserted: { table: string; rows: Record<string, unknown>[] }[] = [];
    const client = {
      from(table: string) {
        return {
          async insert(rows: Record<string, unknown>[]) {
            inserted.push({ table, rows });
            return { error };
          },
        };
      },
    };
    return { client: client as unknown as LearnSupabaseClient, inserted };
  }

  const pressedAt = new Date('2026-09-22T12:00:00.000Z');
  const judgements = [
    { segmentId: 'segment-1', similarity: 0.8, chars: 900, verdict: 'accepted' as const },
    { segmentId: 'segment-2', similarity: 0.7, chars: 200, verdict: 'refused' as const },
  ];

  it('writes one row per judgement in one insert, against the concept', async () => {
    const { client, inserted } = recordingClient();

    await recordJudgements(client, 'user-1', { target: { concept: 'concept-1' }, judgements, pressedAt });

    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe('catalogue_judgements');
    expect(inserted[0].rows).toEqual([
      {
        user_id: 'user-1',
        segment_id: 'segment-1',
        concept_id: 'concept-1',
        similarity: 0.8,
        chars: 900,
        verdict: 'accepted',
        model: JUDGE_MODEL,
        pressed_at: '2026-09-22T12:00:00.000Z',
      },
      {
        user_id: 'user-1',
        segment_id: 'segment-2',
        concept_id: 'concept-1',
        similarity: 0.7,
        chars: 200,
        verdict: 'refused',
        model: JUDGE_MODEL,
        pressed_at: '2026-09-22T12:00:00.000Z',
      },
    ]);
  });

  it('writes against the subject column for a subject target', async () => {
    const { client, inserted } = recordingClient();

    await recordJudgements(client, 'user-1', { target: { subject: 'subject-1' }, judgements, pressedAt });

    expect(inserted[0].rows[0]).toMatchObject({ subject_id: 'subject-1' });
    expect(inserted[0].rows[0]).not.toHaveProperty('concept_id');
  });

  it('throws when the insert is refused, for the pass to catch', async () => {
    const { client } = recordingClient({ message: 'permission denied' });

    await expect(
      recordJudgements(client, 'user-1', { target: { concept: 'concept-1' }, judgements, pressedAt }),
    ).rejects.toThrow('permission denied');
  });
});

/**
 * Which misses count as having looked.
 *
 * #745 records a search time on the claim, and the page reads it to say "we
 * looked and nothing matched". So the line between a press that looked and a
 * press that did not is worth holding still: getting it wrong once makes the
 * page claim a search that never happened, and makes the repeat press treat a
 * timeout as a search already done.
 */
describe('whether a press got an answer out of the catalogue', () => {
  it('counts a covered claim and the two ordinary empty answers', () => {
    expect(searchCompleted(null)).toBe(true);
    expect(searchCompleted('nothing-near')).toBe(true);
    expect(searchCompleted('nothing-taught')).toBe(true);
  });

  it('does not count a press that embedded nothing', () => {
    expect(searchCompleted('no-key')).toBe(false);
    expect(searchCompleted('no-judge-key')).toBe(false);
  });

  it('does not count retrieval that would not answer', () => {
    const refusals: CatalogueMiss[] = ['index', 'rate-limited', 'timeout', 'error', 'malformed'];

    for (const refusal of refusals) expect(searchCompleted(refusal)).toBe(false);
  });

  it('does not count candidates nothing formed a verdict about', () => {
    // Retrieval answered, so segments were found; nothing read them. Saying
    // the claim was searched would be saying they were refused.
    expect(searchCompleted('judge-failed')).toBe(false);
  });
});

/**
 * The second press on the same claim.
 *
 * #743's answer: search again only when new material has arrived. What is
 * worth holding still is that a press with nothing to judge reaches neither
 * outside call and still shows what the last press found, because a skip that
 * quietly showed nothing would look identical to a catalogue that covers
 * nothing.
 *
 * The search is a port here for that reason. A test that stubbed the result
 * could only prove what came back; this one proves that the judging call was
 * never made, which is the thing the step exists for.
 */
function repeatPorts(state: { embeddedSince: boolean; linked: boolean }) {
  const inner = ports(
    found([segment('segment-1')]),
    pass({
      written: [LINK],
      judged: 1,
      judgements: [{ segmentId: 'segment-1', similarity: 0.8, chars: 24, verdict: 'accepted' }],
    }),
  );
  const counts = { searched: 0, asked: [] as string[] };

  return {
    get judged() {
      return inner.judged;
    },
    get searched() {
      return counts.searched;
    },
    get recorded() {
      return inner.recorded;
    },
    get asked() {
      return counts.asked;
    },
    async embeddedSince(at: string) {
      counts.asked.push(at);
      return state.embeddedSince;
    },
    async linked() {
      return state.linked;
    },
    async search() {
      counts.searched += 1;
      return runCatalogueSearch(inner, CLAIM);
    },
  };
}

const SEARCHED_AT = '2026-09-01T10:00:00.000Z';

describe('runCatalogueSearchIfNew', () => {
  it('searches a claim nobody has pressed the button on', async () => {
    const port = repeatPorts({ embeddedSince: false, linked: false });

    const result = await runCatalogueSearchIfNew(port, null);

    expect(result.skipped).toBe(false);
    expect(result.covered).toBe(true);
    expect(port.searched).toBe(1);
    // Nothing to compare against, so nothing is asked about the catalogue.
    expect(port.asked).toEqual([]);
  });

  it('searches again once something has been embedded since the last press', async () => {
    const port = repeatPorts({ embeddedSince: true, linked: false });

    const result = await runCatalogueSearchIfNew(port, SEARCHED_AT);

    expect(result.skipped).toBe(false);
    expect(port.searched).toBe(1);
    expect(port.judged).toBe(1);
    // The new material is what it can appear from, so the press writes links.
    expect(result.written).toBe(1);
    expect(port.asked).toEqual([SEARCHED_AT]);
    expect(port.recorded).toHaveLength(1);
  });

  it('makes no judging call when nothing has arrived, and shows what is stored', async () => {
    const port = repeatPorts({ embeddedSince: false, linked: true });

    const result = await runCatalogueSearchIfNew(port, SEARCHED_AT);

    expect(result.skipped).toBe(true);
    expect(result.covered).toBe(true);
    expect(result.missed).toBeNull();
    expect(port.searched).toBe(0);
    expect(port.judged).toBe(0);
    // Nothing was judged, so nothing is recorded for the trial.
    expect(port.recorded).toEqual([]);
  });

  it('spends nothing on a press that skipped, in either ledger', async () => {
    // What the spend page reads. The press records both of these as they come
    // back, so empty here is no row there.
    const port = repeatPorts({ embeddedSince: false, linked: true });

    const result = await runCatalogueSearchIfNew(port, SEARCHED_AT);

    expect(result.embedSpend).toEqual([]);
    expect(result.judgeSpend).toEqual([]);
    expect(result.considered).toBe(0);
  });

  it('misses on a skip over a claim the last search found nothing for', async () => {
    // The press has somewhere else to go, exactly as it did last time: the
    // reading is queued and the web search runs.
    const port = repeatPorts({ embeddedSince: false, linked: false });

    const result = await runCatalogueSearchIfNew(port, SEARCHED_AT);

    expect(result.covered).toBe(false);
    expect(result.missed).toBe('nothing-new');
    expect(port.judged).toBe(0);
  });

  it('does not count a skip as a search, so the claim keeps its search time', async () => {
    // A skip that moved the time forward would be a claim saying it was
    // searched at a moment nothing looked at it.
    expect(searchCompleted('nothing-new')).toBe(false);
  });
});
