import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { MAX_ITEMS_PER_SOURCE } from '@/lib/learn/levels/draft-sources';
import { SAAS_METRICS } from '@/lib/learn/levels/territories/saas-metrics';
import { readTerritory, unsourcedFrom, type Territory } from '@/lib/learn/levels/territory';
import {
  chosenUnits,
  compilePrompt,
  compileStep,
  compileTerritory,
  documentsToRead,
  MAX_TOPICS,
  MIN_TOPICS,
  readCompiled,
  territoryTexts,
  type CompileDocument,
  type CompileInput,
  type CompilePorts,
  type CompileResult,
} from './compile-territory';
import { freshSteps, type PreparationStepRow, type StepContext } from './run';
import type { PreparationStepKey } from './steps';

const unit = (ordinal: number, heading: string, topics: string[] = []) => ({ ordinal, label: `Week ${ordinal}`, heading, topics });

function doc(over: Partial<CompileDocument> & { itemId: string }): CompileDocument {
  return {
    title: `Course ${over.itemId}`,
    url: `https://example.edu/${over.itemId}`,
    institution: 'MIT',
    courseCode: null,
    term: null,
    units: [unit(1, 'Why cities exist'), unit(2, 'Agglomeration'), unit(3, 'Land rent')],
    matched: [],
    best: 0,
    ...over,
  };
}

const SUBJECT = { id: 'sub-1', name: 'Urban economics', note: 'How cities grow and why rents differ', kind: 'academic_course' };
const FRAMES = ['Urban economics', 'Real estate', 'Transport'];

function input(documents: CompileDocument[]): CompileInput {
  return { subject: SUBJECT, documents, frames: FRAMES };
}

describe('territoryTexts', () => {
  it('puts the documents with most matched weeks first, keys them d1 onwards, and keeps each line once', () => {
    const texts = territoryTexts([
      doc({ itemId: 'a', matched: [1], best: 0.9 }),
      doc({ itemId: 'b', matched: [1, 2], best: 0.6, units: [unit(1, 'Rent'), unit(2, 'Rent')] }),
      doc({ itemId: 'c', units: [] }),
    ]);
    expect(texts.map((t) => [t.key, t.itemId])).toEqual([
      ['d1', 'b'],
      ['d2', 'a'],
    ]);
    expect(texts[0].items).toEqual(['Week 1: Rent', 'Week 2: Rent']);
    expect(texts[1].items[1]).toBe('Week 2: Agglomeration');
    expect(texts[1].label).toBe('MIT, Course a');
  });

  it('keeps the matched units of a long document, in the order taught', () => {
    const units = Array.from({ length: 120 }, (_, i) => unit(i + 1, `Unit ${i + 1}`));
    const kept = chosenUnits(units, [110, 115]);
    expect(kept).toHaveLength(MAX_ITEMS_PER_SOURCE);
    expect(kept.map((u) => u.ordinal)).toContain(115);
    expect(kept.map((u) => u.ordinal)).toEqual([...kept.map((u) => u.ordinal)].sort((a, b) => a - b));
  });
});

describe('readCompiled', () => {
  const documents = [
    doc({ itemId: 'a', matched: [1, 2], best: 0.8, courseCode: '14.01', term: 'Fall 2020' }),
    doc({ itemId: 'b', matched: [1], best: 0.7, courseCode: '14.01', term: 'Spring 2022' }),
    doc({ itemId: 'c', matched: [1], best: 0.6, institution: 'LSE' }),
  ];
  const texts = territoryTexts(documents);

  it('turns cites into lines that exist and sets canonicality by independent documents', () => {
    const { territory, dropped } = readCompiled(
      {
        performances: ['Explain why rents fall with distance from the centre', ''],
        topics: [
          // Two terms of one course are one view: practitioner.
          { ask: 'Agglomeration', scope: 'Why firms cluster.', frame: 'urban economics', target: 5, cites: ['d1.2', 'd2.2'] },
          // A second institution makes it canonical; d9.1 and d1.99 are not lines.
          { ask: 'Land rent', scope: 'The bid-rent curve.', frame: 'Real estate', target: 4.6, cites: ['d1.3', 'd3.3', 'd9.1', 'd1.99'] },
          { ask: 'Congestion pricing', scope: 'Charging for road use.', frame: 'Transport', target: 3, cites: [] },
          { ask: 'land rent', scope: 'Again.', frame: 'Real estate', target: 4, cites: [] },
          { ask: 'Astrology', scope: 'Not offered.', frame: 'Astrology', target: 2, cites: [] },
        ],
      },
      input(documents),
      texts,
    );
    expect(territory.topics.map((t) => [t.ask, t.canonicality, t.target, t.frame])).toEqual([
      ['Agglomeration', 'practitioner', 5, 'Urban economics'],
      ['Land rent', 'canonical', 5, 'Real estate'],
      ['Congestion pricing', 'personal', 3, 'Transport'],
    ]);
    expect(territory.topics[1].from).toEqual(['d1: Week 3: Land rent', 'd3: Week 3: Land rent']);
    expect(dropped).toEqual({ cites: 2, topics: 2 });
    expect(unsourcedFrom(territory)).toEqual([]);
    expect(territory.performances).toEqual(['Explain why rents fall with distance from the centre']);
    expect(territory).toMatchObject({ key: 'subject-sub-1', name: 'Urban economics', subjectLens: 'Urban economics', roles: [], kind: null });
  });

  it('cuts the list at fifty', () => {
    const topics = Array.from({ length: 60 }, (_, i) => ({ ask: `T${i}`, scope: 's', frame: 'Transport', target: 4, cites: ['d1.1'] }));
    const { territory } = readCompiled({ performances: [], topics }, input(documents), texts);
    expect(territory.topics).toHaveLength(MAX_TOPICS);
  });
});

/** A report of n topics, each citing the first line of every document given. */
function report(n: number, docs: number) {
  return {
    performances: ['Explain the bid-rent curve', 'Estimate an agglomeration premium', 'Judge a congestion charge'],
    topics: Array.from({ length: n }, (_, i) => ({
      ask: `Topic ${i + 1}`,
      scope: `What topic ${i + 1} covers.`,
      frame: FRAMES[i % FRAMES.length],
      target: 4,
      cites: Array.from({ length: docs }, (_, d) => `d${d + 1}.1`),
    })),
  };
}

function fakeClient(raw: unknown, seen: { prompt?: string } = {}): Anthropic {
  return {
    messages: {
      create: async (body: { messages: { content: string }[] }) => {
        seen.prompt = body.messages[0].content;
        return {
          content: [{ type: 'tool_use', id: 't', name: 'report_territory', input: raw }],
          usage: { input_tokens: 20_000, output_tokens: 5_000 },
          stop_reason: 'tool_use',
        };
      },
    },
  } as unknown as Anthropic;
}

describe('compileTerritory', () => {
  it('compiles a territory of the same shape as the hand-written fixture', async () => {
    const documents = [doc({ itemId: 'a', matched: [1] }), doc({ itemId: 'b', institution: 'LSE', matched: [2] })];
    const seen: { prompt?: string } = {};
    const spent: unknown[] = [];
    const result = await compileTerritory({
      ...input(documents),
      anthropicApiKey: 'k',
      client: fakeClient(report(36, 2), seen),
      onSpend: (r) => spent.push(r),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { territory } = result;
    expect(territory.topics).toHaveLength(36);
    expect(territory.topics.every((t) => t.canonicality === 'canonical')).toBe(true);
    expect(unsourcedFrom(territory)).toEqual([]);
    expect(spent).toHaveLength(1);
    expect(seen.prompt).toContain('d1.1 Week 1: Why cities exist');
    expect(seen.prompt).toContain('- Real estate');

    // The fixture's keys, plus canonicality, which only a compiled territory carries.
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(territory.topics[0])).toEqual([...keys(SAAS_METRICS.topics[0]), 'canonicality'].sort());
    for (const key of keys(SAAS_METRICS)) expect(territory).toHaveProperty(key);
    expect(readTerritory(JSON.parse(JSON.stringify(territory)))).toEqual(territory);
  });

  it('marks every topic personal when no documents are stored, and says so in the prompt', async () => {
    const seen: { prompt?: string } = {};
    const result = await compileTerritory({ ...input([]), anthropicApiKey: 'k', client: fakeClient(report(32, 0), seen) });
    expect(result.ok && result.territory.topics.every((t) => t.canonicality === 'personal')).toBe(true);
    expect(seen.prompt).toContain('No structure documents are stored');
    expect(compilePrompt(input([]), [])).toContain('Kind of subject: Academic course');
  });

  it('refuses without frame topics rather than inventing them', async () => {
    const result = await compileTerritory({ ...input([]), frames: [], anthropicApiKey: 'k', client: fakeClient(report(32, 0)) });
    expect(result).toEqual({ ok: false, detail: 'No frame topics were found near the subject.' });
  });
});

describe('readTerritory', () => {
  it('reads the fixture back from json and refuses what is not a territory', () => {
    expect(readTerritory(JSON.parse(JSON.stringify(SAAS_METRICS)))).toEqual(JSON.parse(JSON.stringify(SAAS_METRICS)));
    expect(readTerritory(null)).toBeNull();
    expect(readTerritory({ ...SAAS_METRICS, topics: [{ ask: 'x' }] })).toBeNull();
  });
});

describe('documentsToRead', () => {
  it('lists matched documents with their weeks, then pulled ones with none', () => {
    expect(
      documentsToRead(
        [{ itemId: 'p' }, { itemId: 'a' }],
        [
          { itemId: 'a', ordinal: 3, similarity: 0.6 },
          { itemId: 'a', ordinal: 1, similarity: 0.7 },
        ],
      ),
    ).toEqual([
      { itemId: 'a', matched: [3, 1], best: 0.7 },
      { itemId: 'p', matched: [], best: 0 },
    ]);
  });
});

// The step ---------------------------------------------------------------

function context(over: { left?: number; detail?: Record<string, unknown>; documents?: { itemId: string }[] } = {}): StepContext {
  const steps = new Map<PreparationStepKey, PreparationStepRow>(freshSteps().map((s) => [s.key, s]));
  steps.get('pull_documents')!.detail = { documents: over.documents ?? [] };
  steps.get('match_weeks')!.detail = { weeks: [] };
  const step = { ...steps.get('compile_territory')!, detail: over.detail ?? {} };
  const now = 1_000_000;
  return {
    subject: { id: 'sub-1', userId: 'u', name: 'Urban economics', note: null, kind: 'academic_course' },
    run: { id: 'run-1', userId: 'u', subjectId: 'sub-1', status: 'running', currentStep: 'compile_territory', startedAt: null, finishedAt: null, error: null, failures: 0 },
    step,
    steps,
    deadline: now + (over.left ?? 240_000),
    now: () => now,
  };
}

function ports(results: CompileResult[], had: Territory | null = null) {
  const saved: Territory[] = [];
  const asked: CompileInput[] = [];
  const p: CompilePorts = {
    stored: async () => had,
    documents: async (items) => items.map((i) => doc({ itemId: i.itemId })),
    frames: async () => FRAMES,
    compile: async (given) => {
      asked.push(given);
      return results.shift() ?? { ok: false, detail: 'no more' };
    },
    save: async (_run, t) => {
      saved.push(t);
    },
  };
  return { p, saved, asked };
}

function compiled(n: number, docs: CompileDocument[]): CompileResult {
  const texts = territoryTexts(docs);
  return { ok: true, ...readCompiled(report(n, texts.length), input(docs), texts) };
}

describe('compileStep', () => {
  it('compiles from the pulled documents, keeps the territory and counts it', async () => {
    const docs = [doc({ itemId: 'a' }), doc({ itemId: 'b', institution: 'LSE' })];
    const { p, saved, asked } = ports([compiled(40, docs)]);
    const out = await compileStep(p)(context({ documents: [{ itemId: 'a' }, { itemId: 'b' }] }));
    expect(asked[0].documents.map((d) => d.itemId)).toEqual(['a', 'b']);
    expect(saved).toHaveLength(1);
    expect(out).toMatchObject({
      state: 'done',
      summary: 'Laid out 40 topics from 2 documents: 40 canonical, 0 practitioner, 0 personal.',
      counts: { topics: 40, canonical: 40, documents: 2 },
    });
  });

  it('says every topic is personal when nothing was stored', async () => {
    const { p } = ports([compiled(MIN_TOPICS, [])]);
    const out = await compileStep(p)(context());
    expect(out).toMatchObject({ state: 'done', counts: { topics: MIN_TOPICS, personal: MIN_TOPICS, documents: 0 } });
    expect(out.state === 'done' && out.summary).toContain('Every topic is marked personal');
  });

  it('does not compile again once a territory is kept', async () => {
    const kept = compiled(35, []);
    const { p, asked } = ports([], kept.ok ? kept.territory : null);
    const out = await compileStep(p)(context());
    expect(asked).toHaveLength(0);
    expect(out).toMatchObject({ state: 'done', counts: { topics: 35 } });
  });

  it('pauses for a fresh call when the time left is too short for the call', async () => {
    const { p, asked } = ports([compiled(40, [])]);
    const out = await compileStep(p)(context({ left: 60_000 }));
    expect(out).toMatchObject({ state: 'more', pause: true });
    expect(asked).toHaveLength(0);
  });

  it('lays a short territory out once more, then keeps what it has', async () => {
    const { p, saved } = ports([compiled(12, []), compiled(20, [])]);
    const first = await compileStep(p)(context());
    expect(first).toMatchObject({ state: 'more', pause: true, detail: { attempts: 1 } });
    expect(saved).toHaveLength(0);
    const second = await compileStep(p)(context({ detail: { attempts: 1 } }));
    expect(second).toMatchObject({ state: 'done', counts: { topics: 20 } });
    expect(saved).toHaveLength(1);
  });

  it('fails the step with the reason when the call fails', async () => {
    const { p } = ports([{ ok: false, detail: 'Rate limited.' }]);
    await expect(compileStep(p)(context())).rejects.toThrow('Laying out the territory failed: Rate limited.');
  });
});
