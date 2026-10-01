import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalCardSource } from './goal-idea';
import type { Level3Claim, Level3Idea } from './level3-load';

/**
 * Practice Flow questions for the Level 3 goal (plan #1386), with the model
 * stubbed and the rows held in memory.
 *
 * Checked: the pick skips an article with a question waiting and puts the
 * least asked first, the longest claimed between equals; with one claimed,
 * untested article the question is about it, from its card's section, filed
 * in the goal's subject and cross-listed under the article's subject (which
 * is what makes a right answer count as tested); and with nothing claimed the
 * goal hands its turn on.
 */

const SECTION =
  'Photosynthesis converts light energy into chemical energy. In the light-dependent reactions, ' +
  'water is split and oxygen is released as a by-product, while ATP and NADPH carry the energy on.';

const CARD: GoalCardSource = {
  cardId: 'card-1',
  title: 'Photosynthesis: Light reactions',
  text: SECTION,
};

const AIM = {
  id: 'aim-l3',
  name: 'Every Level 3 vital article',
  about: null,
  depth: 'familiar' as const,
  listSource: 'level3',
};

const state = vi.hoisted(() => ({
  claims: [] as Level3Claim[],
  ideas: [] as Level3Idea[],
  cards: [] as GoalCardSource[],
  concepts: [] as Record<string, unknown>[],
  crossListed: [] as { conceptId: string; subjectId: string; article: string }[],
  probes: [] as { conceptId: string; question: string }[],
}));

vi.mock('./subject', () => ({
  surveySubjectForAim: vi.fn(async () => ({ id: 'level3-subject', created: false })),
}));

vi.mock('./level3-load', () => ({
  loadLevel3Claims: vi.fn(async () => state.claims),
  loadLevel3Ideas: vi.fn(async () => state.ideas),
  loadArticleCards: vi.fn(async () => state.cards),
  subjectForArticle: vi.fn(
    async (_s: unknown, _u: string, article: string) => `subject:${article}`,
  ),
  crossList: vi.fn(
    async (_s: unknown, _u: string, conceptId: string, subjectId: string, article: string) => {
      state.crossListed.push({ conceptId, subjectId, article });
    },
  ),
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

const { pickLevel3Article, writeLevel3Question } = await import('./level3-question');

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

function stubModel() {
  const prompts: { tool: string; content: string }[] = [];
  const create = vi.fn(
    async (request: { tools: { name: string }[]; messages: { content: string }[] }) => {
      const tool = request.tools[0]!.name;
      prompts.push({ tool, content: request.messages[0]!.content });
      const input =
        tool === 'report_idea'
          ? {
              name: 'The light reactions release oxygen from water',
              claim: 'In the light-dependent reactions water is split and oxygen released.',
              quote: 'water is split and oxygen is released as a by-product',
              mastery: ['Says where the oxygen from photosynthesis comes from.'],
            }
          : {
              question: 'Where does the oxygen released in photosynthesis come from?',
              options: ['Carbon dioxide', 'Water', 'Glucose'],
              correct_index: 1,
              reason: 'Water is split in the light-dependent reactions.',
            };
      return {
        content: [{ type: 'tool_use', name: tool, input }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    },
  );
  return { client: { messages: { create } } as never, prompts };
}

function idea(article: string, asked: number, waiting = 0): Level3Idea {
  return {
    conceptId: `c-${article}-${asked}-${waiting}`,
    name: `An idea about ${article}`,
    claim: 'A claim.',
    basis: null,
    mastery: [],
    article,
    asked,
    waiting,
  };
}

beforeEach(() => {
  state.claims = [];
  state.ideas = [];
  state.cards = [];
  state.concepts = [];
  state.crossListed = [];
  state.probes = [];
});

describe('pickLevel3Article', () => {
  const claims: Level3Claim[] = [
    { title: 'Photosynthesis', claimedAt: '2026-08-01T00:00:00Z' },
    { title: 'Glacier', claimedAt: '2026-08-05T00:00:00Z' },
    { title: 'Opera', claimedAt: '2026-08-09T00:00:00Z' },
  ];

  it('takes the longest claimed when none has been asked about', () => {
    expect(pickLevel3Article(claims, [])).toBe('Photosynthesis');
  });

  it('skips an article with a question waiting', () => {
    expect(pickLevel3Article(claims, [idea('photosynthesis', 1, 1)])).toBe('Glacier');
  });

  it('puts an article asked about and missed after the ones not asked about yet', () => {
    expect(pickLevel3Article(claims, [idea('Photosynthesis', 1), idea('Glacier', 2)])).toBe(
      'Opera',
    );
  });

  it('returns null when every claimed article has a question waiting, or none is claimed', () => {
    expect(pickLevel3Article(claims.slice(0, 1), [idea('Photosynthesis', 1, 1)])).toBeNull();
    expect(pickLevel3Article([], [])).toBeNull();
  });
});

describe('writeLevel3Question', () => {
  it('asks about the one claimed, untested article, from its card, filed under the article', async () => {
    state.claims = [{ title: 'Photosynthesis', claimedAt: '2026-08-01T00:00:00Z' }];
    state.cards = [CARD];
    const { client, prompts } = stubModel();

    const result = await writeLevel3Question({
      supabase,
      userId: 'user-1',
      aim: AIM,
      anthropicApiKey: 'key',
      client,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.question).toMatchObject({
      subjectId: 'level3-subject',
      aimId: 'aim-l3',
      aimName: 'Every Level 3 vital article',
      source: 'card',
      cardTitle: 'Photosynthesis: Light reactions',
      question: 'Where does the oxygen released in photosynthesis come from?',
    });
    expect(prompts[0]!.content).toContain('Their goal: Photosynthesis');
    expect(prompts[0]!.content).toContain('water is split');
    expect(state.concepts[0]).toMatchObject({ subject_id: 'level3-subject', user_id: 'user-1' });
    expect(state.crossListed).toEqual([
      { conceptId: 'concept-1', subjectId: 'subject:Photosynthesis', article: 'Photosynthesis' },
    ]);
    expect(state.probes).toHaveLength(1);
  });

  it('uses an idea on the article whose question failed before writing a new one', async () => {
    state.claims = [{ title: 'Photosynthesis', claimedAt: '2026-08-01T00:00:00Z' }];
    state.ideas = [
      { ...idea('Photosynthesis', 0), conceptId: 'kept', mastery: ['Names the gas.'] },
    ];
    const { client, prompts } = stubModel();

    const result = await writeLevel3Question({
      supabase,
      userId: 'user-1',
      aim: AIM,
      anthropicApiKey: 'key',
      client,
    });

    expect(result.ok && result.question).toMatchObject({ conceptId: 'kept', source: 'earlier' });
    expect(prompts.map((prompt) => prompt.tool)).not.toContain('report_idea');
    expect(state.concepts).toEqual([]);
  });

  it('hands the turn on when no claimed article is waiting', async () => {
    const { client } = stubModel();
    const result = await writeLevel3Question({
      supabase,
      userId: 'user-1',
      aim: AIM,
      anthropicApiKey: 'key',
      client,
    });
    expect(result).toMatchObject({ ok: false, reason: 'nothing-in-it' });
  });
});
