import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurveyPool } from './pick';

/**
 * The survey writer against a vault with themes in three fields, one of them a
 * track. The reads, the idea writer and the model call are stubbed; what is
 * checked is which theme each question is about and what gets stored.
 */

const state = vi.hoisted(() => ({
  pool: null as unknown as SurveyPool,
  unasked: new Map<
    string,
    { subjectId: string; conceptId: string; name: string; claim: string; mastery: string[] }
  >(),
  ideaFails: new Set<string>(),
  probes: [] as { conceptId: string; flow: unknown }[],
  concepts: new Map<string, string>(),
}));

vi.mock('./load', () => ({
  loadSurveyPool: vi.fn(async () => state.pool),
  loadUnaskedSurveyIdea: vi.fn(
    async (_s: unknown, themeId: string) => state.unasked.get(themeId) ?? null,
  ),
}));

vi.mock('./idea', () => ({
  writeSurveyIdea: vi.fn(async ({ themeId }: { themeId: string }) => {
    if (state.ideaFails.has(themeId)) {
      return { ok: false, reason: 'nothing-in-it', detail: 'Those notes hold no claim to test.' };
    }
    const conceptId = `idea-${themeId}-${state.concepts.size}`;
    state.concepts.set(conceptId, themeId);
    return {
      ok: true,
      subjectId: `survey-${themeId}`,
      conceptId,
      idea: {
        name: `An idea about ${themeId}`,
        claim: 'A claim.',
        basis: 'From your note',
        noteTitle: 'Note',
        quote: 'a quote from the note',
        mastery: ['First check.', 'Second check.'],
        kind: null,
      },
    };
  }),
}));

vi.mock('@/lib/learn/graph/probe', () => ({
  PROBE_MODEL: 'the-probe-model',
  writeProbe: vi.fn(async ({ concept, check }: { concept: string; check: string | null }) => ({
    ok: true,
    probe: {
      question: `What follows from ${concept}?`,
      options: ['A', 'B', 'C'],
      correctIndex: 1,
      reason: 'Because of the claim.',
      masteryCheck: check,
    },
  })),
}));

vi.mock('@/lib/learn/graph/session', () => ({
  nextMasteryCheck: (mastery: string[]) => mastery[0] ?? null,
  recordProbe: vi.fn(
    async (_s: unknown, _u: string, input: { conceptId: string; flow?: unknown }) => {
      state.probes.push({ conceptId: input.conceptId, flow: input.flow });
      // Written counts as asked, which is what moves the next pick on.
      const themeId = state.concepts.get(input.conceptId)!;
      const theme = state.pool.themes.find((t) => t.id === themeId)!;
      for (const [map, id] of [
        [state.pool.counts.byField, theme.fieldId],
        [state.pool.counts.byTheme, themeId],
      ] as const) {
        const count = map.get(id) ?? { asked: 0, answered: 0 };
        map.set(id, { ...count, asked: count.asked + 1 });
      }
      return `probe-${state.probes.length}`;
    },
  ),
}));

vi.mock('@/lib/learn/graph/load', () => ({
  loadConcept: vi.fn(async () => ({ state: 'unknown' })),
}));

const { writeSurveyQuestion } = await import('./question');
const { writeProbe } = await import('@/lib/learn/graph/probe');

function freshPool(): SurveyPool {
  return {
    themes: [
      { id: 'money', name: 'Money', strength: 9, fieldId: 'econ', hasNotes: true },
      { id: 'inflation', name: 'Inflation', strength: 8, fieldId: 'econ', hasNotes: true },
      { id: 'stoicism', name: 'Stoicism', strength: 5, fieldId: 'phil', hasNotes: true },
      { id: 'cells', name: 'Cells', strength: 2, fieldId: 'bio', hasNotes: true },
    ],
    fieldNames: new Map([
      ['econ', 'Economics'],
      ['phil', 'Philosophy'],
      ['bio', 'Biology'],
    ]),
    // Money, the strongest theme, is already a track.
    trackThemeIds: new Set(['money']),
    trackNames: ['Money'],
    trackTestedFields: new Set(),
    counts: { byField: new Map(), byTheme: new Map() },
  };
}

const call = (extra: Partial<Parameters<typeof writeSurveyQuestion>[0]> = {}) =>
  writeSurveyQuestion({
    supabase: {} as never,
    vault: {} as never,
    userId: 'user-1',
    anthropicApiKey: 'key',
    ...extra,
  });

beforeEach(() => {
  state.pool = freshPool();
  state.unasked.clear();
  state.ideaFails.clear();
  state.probes.length = 0;
  state.concepts.clear();
  vi.mocked(writeProbe).mockClear();
});

describe('writeSurveyQuestion', () => {
  it('asks about a theme that is not a track', async () => {
    const result = await call();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.question).toMatchObject({
      themeId: 'inflation',
      themeName: 'Inflation',
      fieldName: 'Economics',
      subjectId: 'survey-inflation',
      question: 'What follows from An idea about inflation?',
      options: ['A', 'B', 'C'],
    });
    expect(vi.mocked(writeProbe).mock.calls[0][0]).toMatchObject({
      check: 'First check.',
      otherChecks: ['Second check.'],
    });
  });

  it('spreads repeated questions across fields', async () => {
    const fields: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await call();
      if (result.ok) fields.push(result.question.fieldId);
    }
    expect(fields).toEqual(['econ', 'phil', 'bio']);
    expect(state.probes).toHaveLength(3);
  });

  it('moves to the next field when a theme has nothing to ask', async () => {
    state.ideaFails.add('inflation');
    const result = await call();
    expect(result.ok && result.question.themeId).toBe('stoicism');
  });

  it('uses an idea not yet asked about before writing another', async () => {
    state.unasked.set('inflation', {
      subjectId: 'survey-inflation',
      conceptId: 'old-idea',
      name: 'An old idea',
      claim: 'Old claim.',
      mastery: [],
    });
    state.concepts.set('old-idea', 'inflation');
    const result = await call();
    expect(result.ok && result.question.conceptId).toBe('old-idea');
  });

  it('records the pick when it is a flow question', async () => {
    await call({ flow: { shownAt: null } });
    expect(state.probes[0].flow).toEqual({
      pickedState: 'unknown',
      pickedRecheck: null,
      shownAt: null,
    });
  });

  it('says there is nothing to ask when every theme is a track', async () => {
    state.pool.trackThemeIds = new Set(state.pool.themes.map((t) => t.id));
    const result = await call();
    expect(result).toMatchObject({ ok: false, reason: 'nothing' });
  });
});
