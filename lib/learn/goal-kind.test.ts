import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  GOAL_KINDS,
  KIND_PLANS,
  PROVIDER_IDS,
  grainForKind,
  kindIsStale,
  providersForKind,
  readKinds,
} from './goal-kind';
import { classifyGoals, describeGoals } from './goal-kind-call';

/**
 * Sorting goals into kinds (plan #2247.2). The model is stubbed with the
 * answers the Learn review expected for its six example goals; what is
 * checked is that the reply is read as sent, that a bad entry is dropped
 * rather than kept wrong, and that the kind alone decides the providers.
 */

const REVIEW_GOALS = [
  { name: 'Corporate finance', about: 'Valuation, capital structure and payout policy at the level of an MBA core course.' },
  { name: 'Quantum thermodynamics', about: 'Work, heat and entropy for small quantum systems, from the current research literature.' },
  { name: 'How French thinking shaped the American Revolution', about: null },
  { name: 'How the Federal Reserve works', about: 'Who decides rates, and how decisions reach banks and borrowers.' },
  { name: 'Beekeeping', about: 'Keeping two hives through a year in a cold climate.' },
  { name: 'The financial services industry', about: 'Banks, asset managers, payments firms and how they make money.' },
] as const;

const EXPECTED = [
  'academic_course',
  'research_subfield',
  'narrow_question',
  'institution',
  'practical_skill',
  'broad_field',
] as const;

function stubClient(kinds: unknown) {
  const create = vi.fn(async () => ({
    content: [{ type: 'tool_use', name: 'report_goal_kinds', id: 't1', input: { kinds } }],
    usage: { input_tokens: 900, output_tokens: 200 },
  }));
  return { client: { messages: { create } } as never, create };
}

describe('classifyGoals', () => {
  it('sorts the six example goals as the review expected', async () => {
    const { client, create } = stubClient(
      EXPECTED.map((kind, i) => ({ goal: i + 1, kind, reason: `Reason ${i + 1}.` })),
    );
    const result = await classifyGoals({ goals: REVIEW_GOALS, anthropicApiKey: 'k', client });
    expect(result.ok && result.answers.map((a) => a.kind)).toEqual([...EXPECTED]);
    const call = (create.mock.calls[0] as unknown as [{ model: string; messages: { content: string }[] }])[0];
    expect(call.model).toMatch(/haiku/);
    expect(call.messages[0].content).toContain('Goal 5: Beekeeping. Keeping two hives');
  });

  it('reports a spend line before reading the reply', async () => {
    const { client } = stubClient([]);
    const onSpend = vi.fn();
    await classifyGoals({ goals: REVIEW_GOALS, anthropicApiKey: 'k', client, onSpend });
    expect(onSpend).toHaveBeenCalledTimes(1);
  });

  it('fails with the reason, not an exception, when the call throws', async () => {
    const client = { messages: { create: vi.fn(async () => { throw new Error('boom'); }) } } as never;
    expect(await classifyGoals({ goals: REVIEW_GOALS, anthropicApiKey: 'k', client })).toEqual({ ok: false, detail: 'boom' });
  });

  it('makes no call for no goals', async () => {
    const { client, create } = stubClient([]);
    expect(await classifyGoals({ goals: [], anthropicApiKey: 'k', client })).toEqual({ ok: true, answers: [] });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('describeGoals', () => {
  it('numbers goals from 1 and joins the line to the name', () => {
    expect(describeGoals([{ name: 'A', about: 'about a' }, { name: 'B', about: null }])).toContain(
      'Goal 1: A. about a\nGoal 2: B\n',
    );
  });
});

describe('readKinds', () => {
  it('drops numbers not asked about, unknown kinds, empty reasons and repeats', () => {
    const answers = readKinds(
      {
        kinds: [
          { goal: 1, kind: 'broad_field', reason: ' A wide area. ' },
          { goal: 1, kind: 'academic_course', reason: 'Second answer for the same goal.' },
          { goal: 2, kind: 'a_new_kind', reason: 'Not one of the six.' },
          { goal: 3, kind: 'institution', reason: '   ' },
          { goal: 9, kind: 'institution', reason: 'Out of range.' },
          { goal: 2.5, kind: 'institution', reason: 'Not a whole number.' },
        ],
      },
      3,
    );
    expect(answers).toEqual([{ goal: 1, kind: 'broad_field', reason: 'A wide area.' }]);
  });

  it('reads a malformed payload as no answers', () => {
    expect(readKinds(null, 2)).toEqual([]);
    expect(readKinds({ kinds: 'broad_field' }, 2)).toEqual([]);
  });
});

describe('the providers a kind decides', () => {
  it('lists providers for every kind, all of them known ids', () => {
    for (const kind of GOAL_KINDS) {
      expect(KIND_PLANS[kind].providers.length).toBeGreaterThan(0);
      for (const id of KIND_PLANS[kind].providers) expect(PROVIDER_IDS).toContain(id);
    }
  });

  it('sends practical skills to extension and certification and never to a university', () => {
    expect(providersForKind('practical_skill')).toEqual(['extension', 'certification']);
  });

  it('sends a research subfield to arXiv first, courses and broad fields to OCW, UT and OpenStax', () => {
    expect(providersForKind('research_subfield')[0]).toBe('arxiv');
    expect(providersForKind('academic_course')).toEqual(['ocw', 'ut_austin', 'openstax', 'yale']);
    expect(providersForKind('broad_field')).toEqual(['ocw', 'ut_austin', 'openstax', 'yale']);
    expect(providersForKind('narrow_question')).toEqual(['monographs', 'primary_sources', 'frame']);
    expect(providersForKind('institution')).toEqual(['official_explainers']);
  });

  it('runs nothing for a goal with no kind', () => {
    expect(providersForKind(null)).toEqual([]);
    expect(grainForKind(null)).toBeNull();
  });

  it('changing the kind changes the providers', () => {
    expect(providersForKind('practical_skill')).not.toEqual(providersForKind('academic_course'));
  });
});

describe('kindIsStale', () => {
  const base = {
    kind: 'broad_field' as const,
    kindBy: 'model' as const,
    kindReadName: 'Name',
    kindReadAbout: null,
    name: 'Name',
    about: null,
  };
  it('is stale when there is no kind', () => {
    expect(kindIsStale({ ...base, kind: null, kindBy: null })).toBe(true);
  });
  it('is stale when the model read other wording', () => {
    expect(kindIsStale({ ...base, name: 'New name' })).toBe(true);
    expect(kindIsStale({ ...base, about: 'now with a line' })).toBe(true);
  });
  it('is current when the wording is what was read', () => {
    expect(kindIsStale(base)).toBe(false);
  });
  it('is never stale once the person set it', () => {
    expect(kindIsStale({ ...base, kindBy: 'person', name: 'Reworded' })).toBe(false);
  });
});
