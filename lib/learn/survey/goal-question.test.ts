import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeDepth } from '@/lib/learn/feed/depth';
import type { GoalCardSource } from './goal-idea';
import type { GoalSubjectState } from './goal-load';

/**
 * Writing a Practice Flow question for a learning goal (plan #1383), with the
 * model stubbed and the goal's rows held in memory.
 *
 * The idea and question calls are the real ones, `ideaForGoal` and
 * `writeProbe`, talking to a stub client that answers by tool name. What is
 * checked: a goal with one Got it card gets an idea quoting that card's
 * section and a question on it; a goal with no cards gets one from its own
 * wording; and two right answers on a familiar goal pitch the next idea a
 * level up.
 */

const SECTION =
  'The burn multiple divides net burn by net new annual recurring revenue. ' +
  'A company burning two dollars for every new dollar of recurring revenue has a burn ' +
  'multiple of two, and investors read anything above two as a warning sign.';

const CARD: GoalCardSource = {
  cardId: 'card-1',
  title: 'Startup metrics: Burn multiple',
  text: SECTION,
};

const AIM = {
  id: 'aim-1',
  name: 'Startup finance',
  about: 'How startups raise, spend and run out of money.',
  depth: 'familiar' as const,
  listSource: null,
};

const state = vi.hoisted(() => ({
  cards: [] as GoalCardSource[],
  subject: { ideas: [], rightAnswers: 0 } as GoalSubjectState,
  concepts: [] as Record<string, unknown>[],
  probes: [] as { conceptId: string; question: string }[],
}));

vi.mock('./subject', () => ({
  surveySubjectForAim: vi.fn(async () => ({ id: 'goal-subject', created: false })),
}));

vi.mock('./goal-load', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./goal-load')>()),
  loadGoalCards: vi.fn(async () => state.cards),
  loadGoalSubjectState: vi.fn(async () => state.subject),
}));

vi.mock('@/lib/learn/graph/session', () => ({
  nextMasteryCheck: (mastery: string[]) => mastery[0] ?? null,
  recordProbe: vi.fn(
    async (_s: unknown, _u: string, input: { conceptId: string; probe: { question: string } }) => {
      state.probes.push({ conceptId: input.conceptId, question: input.probe.question });
      return `probe-${state.probes.length}`;
    },
  ),
}));

vi.mock('@/lib/learn/graph/load', () => ({
  loadConcept: vi.fn(async () => ({ state: 'unknown' })),
}));

const { writeGoalQuestion, unusedCard } = await import('./goal-question');
const { goalQuestionDepth, cardBasisPrefix } = await import('./goal-idea');
const { answeredRight } = await import('./goal-load');

/** `learn.concepts`, enough for the insert. */
const supabase = {
  from(table: string) {
    if (table !== 'concepts') throw new Error(`unexpected table ${table}`);
    return {
      insert(row: Record<string, unknown>) {
        const id = `concept-${state.concepts.length + 1}`;
        state.concepts.push({ id, ...row });
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      },
    };
  },
} as never;

type Idea = { none?: boolean; name?: string; claim?: string; quote?: string; mastery?: string[] };

/** A client that answers the idea call with each of `ideas` in turn, and every question call alike. */
function stubModel(...ideas: Idea[]) {
  const prompts: { tool: string; system: string; content: string }[] = [];
  const create = vi.fn(
    async (request: {
      system: string;
      tools: { name: string }[];
      messages: { content: string }[];
    }) => {
      const tool = request.tools[0]!.name;
      prompts.push({ tool, system: request.system, content: request.messages[0]!.content });
      const input =
        tool === 'report_idea'
          ? ideas.shift()
          : {
              question: 'A startup burns $3m to add $1m of new ARR. What do investors conclude?',
              options: ['It is efficient', 'It is a warning sign', 'Nothing yet'],
              correct_index: 1,
              reason: 'A burn multiple of three is above the level investors treat as healthy.',
            };
      return { content: [{ type: 'tool_use', name: tool, input }], usage: { input_tokens: 1, output_tokens: 1 } };
    },
  );
  return { client: { messages: { create } } as never, prompts };
}

const FROM_CARD: Idea = {
  name: 'A burn multiple above two is a warning sign',
  claim: 'Investors treat burning more than two dollars per new dollar of ARR as a warning.',
  quote: 'investors read anything above two as a warning sign',
  mastery: ['Works out the burn multiple from net burn and new ARR.'],
};

const FROM_WORDING: Idea = {
  name: 'Runway is cash divided by monthly net burn',
  claim: 'Months of runway are the cash in the bank divided by the net burn each month.',
  mastery: ['Says what happens to runway when burn rises.'],
};

const call = (client: never) =>
  writeGoalQuestion({ supabase, userId: 'user-1', aim: AIM, anthropicApiKey: 'key', client });

beforeEach(() => {
  state.cards = [];
  state.subject = { ideas: [], rightAnswers: 0 };
  state.concepts = [];
  state.probes = [];
});

describe('writeGoalQuestion', () => {
  it('writes the idea from a Got it card, quoting its section, and a question on it', async () => {
    state.cards = [CARD];
    const { client, prompts } = stubModel(FROM_CARD);

    const written = await call(client);

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.question).toMatchObject({
      source: 'card',
      cardTitle: CARD.title,
      aimId: AIM.id,
      aimName: AIM.name,
      subjectId: 'goal-subject',
      conceptName: FROM_CARD.name,
      depth: 'working',
    });
    // The section went to the model, and the stored idea quotes it.
    expect(prompts[0]!.content).toContain(SECTION);
    expect(state.concepts).toHaveLength(1);
    expect(state.concepts[0]).toMatchObject({ subject_id: 'goal-subject', name: FROM_CARD.name });
    expect(String(state.concepts[0]!.basis)).toBe(
      `${cardBasisPrefix(CARD.title)} in Learn now: "${FROM_CARD.quote}"`,
    );
    expect(SECTION).toContain(FROM_CARD.quote!);
    // And the question is about that idea.
    expect(prompts[1]!.tool).toBe('report_question');
    expect(prompts[1]!.content).toContain(FROM_CARD.claim!);
    expect(state.probes).toEqual([{ conceptId: 'concept-1', question: written.question.question }]);
  });

  it("falls back to the goal's wording when there are no cards", async () => {
    const { client, prompts } = stubModel(FROM_WORDING);

    const written = await call(client);

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.question).toMatchObject({ source: 'wording', cardTitle: null });
    expect(prompts[0]!.content).toContain(`Their goal: ${AIM.name}`);
    expect(prompts[0]!.content).toContain(AIM.about);
    expect(prompts[0]!.content).not.toContain('The section they read');
    expect(state.concepts[0]).toMatchObject({ basis: `From your goal "${AIM.name}"` });
    expect(state.probes).toHaveLength(1);
  });

  it("falls back to the goal's wording when the card's section holds no claim", async () => {
    state.cards = [CARD];
    const { client, prompts } = stubModel({ none: true }, FROM_WORDING);

    const written = await call(client);

    expect(written.ok && written.question.source).toBe('wording');
    expect(prompts.map((p) => p.tool)).toEqual(['report_idea', 'report_idea', 'report_question']);
  });

  it('refuses a quote that is not in the section, then uses the wording', async () => {
    state.cards = [CARD];
    const { client } = stubModel({ ...FROM_CARD, quote: 'a sentence the section never says at all' }, FROM_WORDING);

    const written = await call(client);

    expect(written.ok && written.question.source).toBe('wording');
    expect(state.concepts).toHaveLength(1);
    expect(state.concepts[0]!.name).toBe(FROM_WORDING.name);
  });

  it('skips a card an idea was already written from', async () => {
    state.cards = [CARD];
    state.subject = {
      ideas: [
        {
          conceptId: 'old',
          name: FROM_CARD.name!,
          claim: FROM_CARD.claim!,
          basis: `${cardBasisPrefix(CARD.title)} in Learn now: "${FROM_CARD.quote}"`,
          mastery: [],
          asked: 1,
        },
      ],
      rightAnswers: 0,
    };
    const { client, prompts } = stubModel(FROM_WORDING);

    const written = await call(client);

    expect(written.ok && written.question.source).toBe('wording');
    // The idea already written is named so the model picks another.
    expect(prompts[0]!.content).toContain(`- ${FROM_CARD.name}`);
  });

  it('asks again about an idea whose question was never written, without a new idea', async () => {
    state.subject = {
      ideas: [{ conceptId: 'waiting', name: 'An idea', claim: 'A claim.', basis: null, mastery: [], asked: 0 }],
      rightAnswers: 0,
    };
    const { client, prompts } = stubModel();

    const written = await call(client);

    expect(written.ok && written.question.conceptId).toBe('waiting');
    expect(prompts.map((p) => p.tool)).toEqual(['report_question']);
    expect(state.concepts).toHaveLength(0);
  });

  it('pitches the next idea a level up after two right answers on a familiar goal', async () => {
    const asked = { conceptId: 'c', name: 'Done', claim: 'Done.', basis: null, mastery: [], asked: 1 };

    state.subject = { ideas: [asked], rightAnswers: 1 };
    const one = stubModel(FROM_WORDING);
    const afterOne = await call(one.client);
    expect(afterOne.ok && afterOne.question.depth).toBe('working');
    expect(one.prompts[0]!.content).toContain(describeDepth('working'));

    state.subject = { ideas: [asked], rightAnswers: 2 };
    const two = stubModel(FROM_WORDING);
    const afterTwo = await call(two.client);
    expect(afterTwo.ok && afterTwo.question.depth).toBe('advanced');
    expect(two.prompts[0]!.content).toContain(describeDepth('advanced'));
  });

  it('leaves the Level 3 goal to its own questions', async () => {
    const { client, prompts } = stubModel();
    const written = await writeGoalQuestion({
      supabase,
      userId: 'user-1',
      aim: { ...AIM, listSource: 'level3' },
      anthropicApiKey: 'key',
      client,
    });
    expect(written).toMatchObject({ ok: false, reason: 'list' });
    expect(prompts).toHaveLength(0);
  });
});

describe('goalQuestionDepth', () => {
  it("starts at the goal's card depth and steps up with right answers", () => {
    expect(goalQuestionDepth('familiar', 0)).toBe('working');
    expect(goalQuestionDepth('familiar', 1)).toBe('working');
    expect(goalQuestionDepth('familiar', 2)).toBe('advanced');
    expect(goalQuestionDepth('solid', 0)).toBe('advanced');
    expect(goalQuestionDepth('solid', 3)).toBe('specialist');
    expect(goalQuestionDepth('deep', 0)).toBe('specialist');
  });
});

describe('unusedCard', () => {
  it('takes the newest card no idea came from', () => {
    const older = { ...CARD, cardId: 'card-0', title: 'Startup metrics: Runway' };
    const ideas = [{ basis: `${cardBasisPrefix(CARD.title)} in Learn now: "x"` }];
    expect(unusedCard([CARD, older], ideas)).toBe(older);
    expect(unusedCard([CARD], ideas)).toBeNull();
  });
});

describe('answeredRight', () => {
  const probe = { correct_index: 1, chosen_index: 1, dont_know: false, response_correct: null };
  it('counts a right choice or a written answer marked right, never a don\'t know', () => {
    expect(answeredRight(probe)).toBe(true);
    expect(answeredRight({ ...probe, chosen_index: 0 })).toBe(false);
    expect(answeredRight({ ...probe, chosen_index: null })).toBe(false);
    expect(answeredRight({ ...probe, chosen_index: null, response_correct: true })).toBe(true);
    expect(answeredRight({ ...probe, dont_know: true })).toBe(false);
  });
});
