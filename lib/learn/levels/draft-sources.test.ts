import { describe, expect, it } from 'vitest';
import {
  bothOrEither,
  citeIds,
  coverageCheck,
  draftOverlap,
  draftingRecord,
  numbered,
  performancesFromText,
  pickDraft,
  readDrafting,
  rolesSource,
  sourceText,
  sourcesFromText,
  sourcesPrompt,
  structureCheck,
  validCites,
  type CitedDraft,
  type DraftSources,
} from './draft-sources';

const GIVEN: DraftSources = {
  sources: [
    { id: 'S1', label: 'CFA syllabus', items: ['Calculate FCFF', 'Calculate a terminal value', 'Explain real options'] },
    { id: 'S2', label: 'Damodaran, contents', items: [] },
  ],
  performances: ['Value a listed company', 'Explain why the value moved'],
};

function draft(over: Partial<CitedDraft> = {}): CitedDraft & { name: string; checklist: string[] } {
  return {
    name: 'DCF',
    checklist: ['Does level 4 include a reverse DCF?'],
    ceiling: 4,
    topicCites: ['S2'],
    cells: [1, 2, 3, 4].map((level) => ({
      level,
      checks: [`Can compute the free cash flow at level ${level}`, 'Can explain the terminal value'],
      cites: level === 2 ? ['S1.1'] : level === 3 ? ['S1.2'] : [],
    })),
    links: [{ fromLevel: 2, topicName: 'Return', level: 2, cites: ['S2'] }],
    performanceLevels: [3, null],
    outOfScope: ['S1.3'],
    ...over,
  };
}

describe('reading what was pasted', () => {
  it('splits sources on blank lines, names each by its first line and strips list marks', () => {
    const sources = sourcesFromText('CFA syllabus\n1. Calculate FCFF\n- Calculate FCFF\n• Explain it\n\n\nA textbook\n');
    expect(sources).toEqual([
      { id: 'S1', label: 'CFA syllabus', items: ['Calculate FCFF', 'Explain it'] },
      { id: 'S2', label: 'A textbook', items: [] },
    ]);
  });

  it('keeps at most five performances, one a line', () => {
    expect(performancesFromText('a\nb\n\nc\nd\ne\nf')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('makes the roles’ requirement lines one source, deduplicated, and none when they have no lines', () => {
    const roles = rolesSource('FP&A', [
      { title: 'FP&A Manager', company: 'Acme', lines: ['Advanced Excel', 'SQL'] },
      { title: 'Senior FP&A', company: null, lines: ['advanced excel'] },
    ]);
    expect(roles).toEqual({ label: 'Requirement lines of 2 roles you pursued matching “FP&A”', items: ['Advanced Excel', 'SQL'] });
    expect(rolesSource('FP&A', [{ title: 'x', company: null, lines: [] }])).toBeNull();
    expect(numbered([roles!, { label: 'B', items: [] }]).map((s) => s.id)).toEqual(['S1', 'S2']);
  });
});

describe('citing', () => {
  it('numbers sources, lines and performances for the call', () => {
    const lines = sourcesPrompt(GIVEN).join('\n');
    expect(lines).toContain('P2. Explain why the value moved');
    expect(lines).toContain('  S1.2 Calculate a terminal value');
    expect(lines).toContain('S2. Damodaran, contents');
  });

  it('keeps only ids that were given', () => {
    expect(validCites(['s1.2', 'S9', 'P1', 'S1.2', 'S1.4'], citeIds(GIVEN))).toEqual(['S1.2', 'P1']);
  });

  it('writes a citation in words', () => {
    expect(sourceText(['S1.1', 'S2', 'P1'], GIVEN)).toBe(
      'CFA syllabus: Calculate FCFF; Damodaran, contents; Your performance: Value a listed company',
    );
    expect(sourceText([], GIVEN)).toBeNull();
  });
});

describe('the checks', () => {
  it('counts coverage over the lines that belong to the topic', () => {
    const coverage = coverageCheck(draft(), GIVEN);
    expect(coverage.share).toBe(1);
    expect(coverage.sources[0]).toMatchObject({ covered: 2, inScope: 2, total: 3 });

    const thin = coverageCheck(draft({ outOfScope: [] }), GIVEN);
    expect(thin.share).toBeCloseTo(2 / 3);
    expect(thin.uncovered).toEqual(['S1.3 Explain real options']);
  });

  it('has no coverage to count when no source has lines', () => {
    expect(coverageCheck(draft(), { sources: [GIVEN.sources[1]], performances: [] }).share).toBeNull();
  });

  it('lists levels above every performance’s level as off the path, and performances it does not serve', () => {
    const structure = structureCheck(draft(), GIVEN, 'DCF');
    expect(structure).toMatchObject({
      acyclic: true,
      offPath: [4],
      served: [{ performance: 'Value a listed company', level: 3 }],
      unserved: ['Explain why the value moved'],
    });
    expect(structureCheck(draft(), { ...GIVEN, performances: [] }, 'DCF').offPath).toEqual([]);
  });

  it('finds a requirement loop through the map', () => {
    expect(structureCheck(draft(), GIVEN, 'DCF', [['Return', 'DCF']]).acyclic).toBe(false);
    expect(structureCheck(draft(), GIVEN, 'DCF', [['Return', 'Interest']]).acyclic).toBe(true);
  });

  it('measures how far two drafts agree', () => {
    expect(draftOverlap(draft(), draft())).toBe(1);
    const other = draft({
      ceiling: 2,
      cells: [
        { level: 1, checks: ['Can name a bond'], cites: [] },
        { level: 2, checks: ['Can price a coupon'], cites: ['S1.3'] },
      ],
      links: [],
      topicCites: [],
    });
    const overlap = draftOverlap(draft(), other);
    expect(overlap).toBeGreaterThanOrEqual(0);
    expect(overlap).toBeLessThan(0.2);
  });

  it('keeps the draft more of whose rows cite a source', () => {
    const bare = draft({ topicCites: [], links: [{ fromLevel: 2, topicName: 'Return', level: 2, cites: [] }] });
    expect(pickDraft(bare, draft(), GIVEN)).not.toBe(bare);
    const a = draft();
    expect(pickDraft(a, draft(), GIVEN)).toBe(a);
  });

  it('records both drafts, or why the second is missing', () => {
    expect(draftingRecord(draft(), draft(), null, GIVEN).overlap).toBe(1);
    const alone = draftingRecord(draft(), null, 'Request timed out', GIVEN);
    expect(alone.overlap).toBeNull();
    expect(alone.overlapMissing).toContain('Request timed out');
    expect(readDrafting(JSON.parse(JSON.stringify(alone)))).toEqual(alone);
    expect(readDrafting(null)).toBeNull();
  });
});

describe('two calls as one', () => {
  const ok = (name: string) => ({ ok: true as const, draft: { name } as never });
  const failed = { ok: false as const, reason: 'error' as const, detail: 'boom' };
  const vague = { ok: false as const, reason: 'too-vague' as const, detail: 'too broad' };

  it('keeps both, or the one that came back', () => {
    expect(bothOrEither(ok('a'), ok('b'))).toMatchObject({ ok: true, other: { name: 'b' }, failed: null });
    expect(bothOrEither(failed, ok('b'))).toMatchObject({ ok: true, draft: { name: 'b' }, other: null, failed: 'boom' });
    expect(bothOrEither(failed, failed)).toEqual(failed);
  });

  it('calls a goal too broad when either call did', () => {
    expect(bothOrEither(ok('a'), vague)).toEqual(vague);
  });
});
