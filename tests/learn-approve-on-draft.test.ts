/**
 * A topic is approved as soon as it is drafted (plan #2356.2), from a goal
 * named on Topics, from a research brief, and from a territory tick. Each
 * path approves the draft with no one pressing Approve, marking any row that
 * cites no source personal first (plan #2356.6).
 *
 * The drafting call itself is stubbed: it lays the topic's rows into an
 * in-memory learn schema the way saveDraft would, and the real approval code
 * runs over them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeLearnClient, type FakeRow, type FakeTables } from './helpers/fake-learn-client';
import type { Territory } from '@/lib/learn/levels/territory';

const ME = '00000000-0000-4000-8000-000000000001';
const BRIEF = '22222222-2222-4222-8222-222222222222';
const AIM = '33333333-3333-4333-8333-333333333333';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  /** What the stubbed drafting call keeps, by the goal it is asked for. */
  drafts: {} as Record<string, { topic: Record<string, unknown>; cells: Record<string, unknown>[] }>,
  cards: [] as string[],
  afters: [] as (() => unknown)[],
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => state.afters.push(fn) }));
vi.mock('@/inngest/learn/feed-top-up', () => ({
  writeCardsForBrief: async (_userId: string, briefId: string) => {
    state.cards.push(briefId);
  },
}));
vi.mock('@/lib/auth/server', () => ({ requireUser: async () => ({ id: ME, email: 'me@example.com' }) }));
vi.mock('@/lib/learn/auth/server', () => ({ createLearnClient: async () => fakeLearnClient(state.tables) }));
vi.mock('@/lib/learn/levels/role-sources', () => ({
  roleRequirementSource: async () => null,
  roleRequirementSourceFrom: async () => null,
}));

/** Keeps the draft prepared for this goal, as saveDraft would, and returns its id. */
async function keepDraft(goal: string) {
  const draft = state.drafts[goal];
  if (!draft) return { ok: false as const, detail: `no draft prepared for ${goal}` };
  (state.tables.topics ??= []).push(draft.topic);
  (state.tables.topic_cells ??= []).push(...draft.cells);
  return { ok: true as const, id: draft.topic.id as string };
}

vi.mock('@/lib/learn/levels/draft-run', () => ({
  runTopicDraft: async (_client: unknown, _userId: string, input: { goal: string }) => keepDraft(input.goal),
}));
vi.mock('@/lib/learn/briefs/topics-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/learn/briefs/topics-store')>()),
  draftBriefTopic: async () => keepDraft('brief question'),
}));

const { approveDrafts } = await import('@/lib/learn/levels/store');
const { draftTopicFromGoal } = await import('@/app/learn/topics/actions');
const { draftBriefTopics } = await import('@/app/learn/b/[id]/actions');
const { draftTerritoryTick } = await import('@/lib/learn/levels/territory-run');

let next = 0;

/**
 * Prepares the draft the stubbed call keeps for `goal`: a topic with three
 * levels, every row citing S1 unless `uncitedLevel` names a level that cites
 * nothing. `uncitedAll` leaves the topic and every level citing nothing.
 */
function prepare(goal: string, options: { uncitedLevel?: number; uncitedAll?: boolean; drafting?: FakeRow } = {}): string {
  next += 1;
  const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`;
  const cited = options.uncitedAll ? { source: null, canonicality: null } : { source: 'S1', canonicality: 'practitioner' };
  state.drafts[goal] = {
    topic: {
      id,
      user_id: ME,
      name: goal,
      asked: goal,
      status: 'draft',
      approved_at: null,
      ceiling: 3,
      drafting: options.drafting ?? null,
      ...cited,
    },
    cells: [1, 2, 3].map((level) => ({
      id: `${id}-${level}`,
      user_id: ME,
      topic_id: id,
      level,
      descriptor: [`Check at level ${level}`],
      descriptor_original: null,
      ...(level === options.uncitedLevel ? { source: null, canonicality: null } : cited),
    })),
  };
  return id;
}

const topic = (id: string) => state.tables.topics.find((t) => t.id === id)!;
const levels = (id: string) => state.tables.topic_cells.filter((c) => c.topic_id === id);
/** The topic's canonicality, then each level's. */
const marks = (id: string) => [topic(id).canonicality, ...levels(id).map((c) => c.canonicality)];

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  state.tables = { topics: [], topic_cells: [], cell_links: [] } satisfies FakeTables;
  state.drafts = {};
  state.cards = [];
  state.afters = [];
});

describe('approveDrafts', () => {
  it('approves a fully cited draft as drafted and marks nothing personal', async () => {
    const cited = prepare('cited');
    await keepDraft('cited');
    const client = fakeLearnClient(state.tables);

    expect(await approveDrafts(client, [cited])).toEqual([{ id: cited, personal: 0 }]);
    expect(topic(cited)).toMatchObject({ status: 'approved' });
    expect(topic(cited).approved_at).toEqual(expect.any(String));
    expect(levels(cited).map((c) => c.descriptor_original)).toEqual([null, null, null]);
    expect(marks(cited)).toEqual(['practitioner', 'practitioner', 'practitioner', 'practitioner']);

    expect(await approveDrafts(client, [cited])).toEqual([]);
  });

  it('approves a partly uncited draft with the uncited level marked personal', async () => {
    const partly = prepare('partly', { uncitedLevel: 2 });
    await keepDraft('partly');

    expect(await approveDrafts(fakeLearnClient(state.tables), [partly])).toEqual([{ id: partly, personal: 1 }]);
    expect(topic(partly)).toMatchObject({ status: 'approved' });
    expect(marks(partly)).toEqual(['practitioner', 'practitioner', 'personal', 'practitioner']);
    expect(levels(partly).map((c) => c.source)).toEqual(['S1', null, 'S1']);
  });

  it('approves a wholly uncited draft with the topic, every level and every link marked personal', async () => {
    const wholly = prepare('wholly', { uncitedAll: true });
    await keepDraft('wholly');
    state.tables.cell_links.push({ id: 'link-1', requiring_cell_id: `${wholly}-2`, source: null, canonicality: null });

    expect(await approveDrafts(fakeLearnClient(state.tables), [wholly])).toEqual([{ id: wholly, personal: 5 }]);
    expect(topic(wholly)).toMatchObject({ status: 'approved' });
    expect(marks(wholly)).toEqual(['personal', 'personal', 'personal', 'personal']);
    expect(state.tables.cell_links[0]).toMatchObject({ canonicality: 'personal' });
  });
});

describe('a topic drafted from a goal on Topics', () => {
  it('is approved when every row cites a source', async () => {
    const id = prepare('DCF');
    expect(await draftTopicFromGoal({}, form({ goal: 'DCF' }))).toBeUndefined();
    expect(topic(id)).toMatchObject({ status: 'approved' });
  });

  it('is approved with the row that cites nothing marked personal', async () => {
    const id = prepare('WACC', { uncitedLevel: 3 });
    await draftTopicFromGoal({}, form({ goal: 'WACC' }));
    expect(topic(id)).toMatchObject({ status: 'approved' });
    expect(levels(id).find((c) => c.level === 3)).toMatchObject({ canonicality: 'personal' });
  });
});

describe('a topic drafted from a research brief', () => {
  const fromBrief = { brief: { id: BRIEF, question: 'brief question', aimId: AIM, aimName: 'Run a model' } };

  beforeEach(() => {
    state.tables.aims = [{ id: AIM, user_id: ME, subject_id: 'subject', depth: 'solid' }];
    state.tables.lenses = [{ id: 'goal-lens', user_id: ME, subject_id: 'subject' }];
    state.tables.lens_targets = [];
    state.tables.briefs = [{ id: BRIEF, user_id: ME, aim_id: null }];
  });

  it('is approved, put on the goal’s lens, and has the brief’s cards written', async () => {
    const id = prepare('brief question', { drafting: fromBrief });
    await draftBriefTopics(BRIEF, AIM);
    expect(topic(id)).toMatchObject({ status: 'approved' });
    expect(state.tables.lens_targets).toEqual([expect.objectContaining({ lens_id: 'goal-lens', topic_id: id })]);
    expect(state.tables.briefs[0]).toMatchObject({ aim_id: AIM });
    for (const write of state.afters) await write();
    expect(state.cards).toEqual([BRIEF]);
  });

  it('is approved and put on the goal’s lens when a row cites nothing, with that row marked personal', async () => {
    const id = prepare('brief question', { drafting: fromBrief, uncitedLevel: 1 });
    await draftBriefTopics(BRIEF, AIM);
    expect(topic(id)).toMatchObject({ status: 'approved' });
    expect(levels(id).find((c) => c.level === 1)).toMatchObject({ canonicality: 'personal' });
    expect(state.tables.lens_targets).toEqual([expect.objectContaining({ lens_id: 'goal-lens', topic_id: id })]);
    expect(state.tables.briefs[0]).toMatchObject({ aim_id: AIM });
  });
});

describe('a topic drafted in a territory tick', () => {
  const territory: Territory = {
    key: 'valuation',
    name: 'Valuation',
    subjectLens: 'Valuation',
    performances: [],
    roles: [],
    texts: [],
    topics: [
      { ask: 'Discounting', scope: 'Present value', frame: 'Corporate finance', target: 3, from: [] },
      { ask: 'Multiples', scope: 'Comparable companies', frame: 'Corporate finance', target: 3, from: [] },
    ],
  };

  it('is approved whether every row cites a source or one is marked personal', async () => {
    state.tables.area_check_articles = [];
    state.tables.lenses = [{ id: 'subject-lens', user_id: ME, origin: 'subject', name: 'Valuation' }];
    state.tables.lens_targets = [];
    const cited = prepare('Discounting');
    const uncited = prepare('Multiples', { uncitedLevel: 2 });

    const tick = await draftTerritoryTick(
      { learn: fakeLearnClient(state.tables), jobs: {} as never },
      ME,
      territory,
      { anthropicApiKey: 'test-key', budgetMs: 600_000 },
    );

    expect(tick.drafted.map((d) => [d.id, d.approved])).toEqual([
      [cited, true],
      [uncited, true],
    ]);
    expect(topic(cited)).toMatchObject({ status: 'approved' });
    expect(topic(uncited)).toMatchObject({ status: 'approved' });
    expect(levels(uncited).find((c) => c.level === 2)).toMatchObject({ canonicality: 'personal' });
  });
});
