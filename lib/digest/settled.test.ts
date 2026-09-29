import { describe, expect, it } from 'vitest';
import {
  isRunObservation,
  namedRows,
  suggestionRows,
  withStatuses,
  withoutSettled,
  type PlanRowState,
} from '@/lib/digest/settled';
import {
  MORNING_REPEATS,
  ROWS_ON_29_SEPTEMBER,
  asSuggestion,
} from '@/lib/ideas/fixtures/morning-repeats';

/** The plan as it stood when the run fired on 29 September. */
const SEPTEMBER_29: PlanRowState[] = ROWS_ON_29_SEPTEMBER.map((row) => ({
  number: row.number,
  kind: row.kind,
  status: row.status,
  dismissedAt: null,
}));

function repeat(id: string) {
  const idea = MORNING_REPEATS.find((row) => row.id === id);
  if (!idea) throw new Error(`no fixture ${id}`);
  return asSuggestion(idea);
}

describe('withoutSettled', () => {
  it('drops both 29 September filings, whose rows had all closed', () => {
    const filed = [repeat('1e5937f9'), repeat('d6d28a49')];

    expect(filed[0].title).toContain('#985, #986, #1001');
    expect(filed[1].title).toContain('#1048');
    expect(withoutSettled(filed, SEPTEMBER_29)).toEqual([]);
  });

  it('drops every repeat from 25 to 29 September against the plan on the 29th', () => {
    expect(withoutSettled(MORNING_REPEATS.map(asSuggestion), SEPTEMBER_29)).toEqual([]);
  });

  it('keeps a suggestion naming one row that is still open', () => {
    const plan: PlanRowState[] = [
      ...SEPTEMBER_29,
      { number: 1100, kind: 'build', status: 'blocked', dismissedAt: null },
    ];
    const kept = { title: 'A step blocked for a fortnight (#1100)', detail: null };

    expect(withoutSettled([kept], plan)).toEqual([kept]);
  });

  it('keeps a suggestion naming one open row beside closed ones', () => {
    const plan: PlanRowState[] = [
      ...SEPTEMBER_29,
      { number: 1100, kind: 'decision', status: 'not_started', dismissedAt: null },
    ];
    const kept = {
      title: 'The information-step questions are answered (#988, #992)',
      detail: 'But the one they led to (#1100) is still waiting.',
    };

    expect(withoutSettled([kept], plan)).toEqual([kept]);
  });

  it('passes a suggestion that names no row through unchanged', () => {
    const plain = { title: 'Nothing has shipped in Learn for a week', detail: null };

    expect(withoutSettled([plain], SEPTEMBER_29)).toEqual([plain]);
  });

  it('treats a dismissed row as settled, and an unknown number as not', () => {
    const plan: PlanRowState[] = [
      { number: 5, kind: 'decision', status: 'not_started', dismissedAt: '2026-09-01T00:00:00Z' },
    ];

    expect(withoutSettled([{ title: 'The question (#5)', detail: null }], plan)).toEqual([]);
    expect(withoutSettled([{ title: 'Something (#9999)', detail: null }], plan)).toHaveLength(1);
  });
});

describe('namedRows', () => {
  it('resolves each number once, in order, with its status now', () => {
    const rows = suggestionRows(repeat('d6d28a49'), SEPTEMBER_29);

    expect(rows.map((row) => row.number)).toEqual([1048, 988, 992, 1022]);
    expect(rows.every((row) => row.status === 'done' && row.settled)).toBe(true);
    expect(rows[0].kind).toBe('decision');
  });

  it('does not read an HTML entity or a word starting with digits as a row', () => {
    expect(namedRows('it&#39;s #12a and ##13', SEPTEMBER_29)).toEqual([]);
  });

  it('says so when no row has the number', () => {
    expect(namedRows('see #4242', SEPTEMBER_29)).toEqual([
      { number: 4242, status: null, kind: null, dismissed: false, settled: false },
    ]);
  });
});

describe('withStatuses', () => {
  it('writes the status beside every number the model reads', () => {
    const plan: PlanRowState[] = [
      ...SEPTEMBER_29,
      { number: 12, kind: 'build', status: 'in_progress', dismissedAt: null },
    ];

    expect(withStatuses('Blocked on #985 and #1048; #12 is underway; #4242 is unknown', plan)).toBe(
      'Blocked on #985 (done) and #1048 (answered); #12 (in progress) is underway; #4242 is unknown',
    );
  });

  it('leaves text with no numbers alone', () => {
    expect(withStatuses('Nothing to see', SEPTEMBER_29)).toBe('Nothing to see');
  });
});

describe('isRunObservation', () => {
  it('is the run’s own line: Dash, no workspace, out of no step', () => {
    expect(isRunObservation({ source: 'claude', module: null, from: null })).toBe(true);
    expect(isRunObservation({ source: 'me', module: null, from: null })).toBe(false);
    expect(isRunObservation({ source: 'claude', module: 'learn', from: null })).toBe(false);
    expect(
      isRunObservation({ source: 'claude', module: null, from: { number: 669, title: 'x' } }),
    ).toBe(false);
  });
});
