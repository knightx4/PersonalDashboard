import { describe, expect, it, vi } from 'vitest';
import { NOT_SOURCES, SOURCES } from '@/lib/sources/catalogue';
import {
  REACH_OUT_REPLY_SCHEMA,
  REACH_OUT_TABLES,
  makeReachOutRule,
  readReachOutReply,
  reachOutSummary,
  saveReachOut,
} from '@/lib/you/reach-out-make';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The three examples from feature #2931 and two failures, each given as the
 * reply the model recorded, so the checks run without a model.
 */

const HIRING_MANAGER =
  'Tell me when you find new jobs that fit, give me a weekly round-up of rejections and replies, and now and then name one person I should contact, never the same one twice.';
const JERWYN = 'Sum up wise advice from my insights and new notes about once a fortnight.';
const BUILDER = 'Give me highlights of what shipped, your best ideas and what is waiting on me.';
const WITH_GAP = 'Tell me when a Learn reading is finished, and remind me before my sister’s birthday.';

const REPLIES: Record<string, unknown> = {
  [HIRING_MANAGER]: {
    watches: [
      {
        key: 'new_roles',
        about: 'New jobs that fit you',
        tables: ['job_search.suggestions', 'job_search.roles'],
        mode: 'each',
        every_days: 1,
        repeat_after_days: null,
        form: null,
      },
      {
        key: 'application_news',
        about: 'Rejections and replies on your applications',
        tables: ['job_search.application_events'],
        mode: 'roundup',
        every_days: 7,
        repeat_after_days: null,
        form: 'list',
      },
      {
        key: 'person_to_contact',
        about: 'One person to contact',
        tables: ['job_search.contacts'],
        mode: 'pick',
        every_days: 14,
        repeat_after_days: null,
        form: 'bubbles',
      },
    ],
    cannot_watch: [],
    understood:
      'The hiring manager will text you as new jobs that fit turn up, send a round-up of rejections and replies each week, and every two weeks name one person to contact, never the same one twice.',
  },
  [JERWYN]: {
    watches: [
      {
        key: 'wise_advice',
        about: 'Advice from your insights and new notes',
        tables: ['you.insights', 'obsidian.notes'],
        mode: 'roundup',
        every_days: 14,
        repeat_after_days: 30,
        form: 'bubbles',
      },
    ],
    cannot_watch: [],
    understood: 'Jerwyn the Elder will text you about once a fortnight with advice drawn from your insights and your new notes.',
  },
  [BUILDER]: {
    watches: [
      {
        key: 'shipped',
        about: 'Highlights of what shipped',
        tables: ['public.plan_items'],
        mode: 'roundup',
        every_days: 7,
        repeat_after_days: null,
        form: 'list',
      },
      {
        key: 'best_ideas',
        about: 'The best ideas',
        tables: ['public.ideas'],
        mode: 'pick',
        every_days: 7,
        repeat_after_days: 60,
        form: 'bubbles',
      },
      {
        key: 'waiting_on_you',
        about: 'What is waiting on you',
        tables: ['public.plan_items'],
        mode: 'roundup',
        every_days: 7,
        repeat_after_days: 7,
        form: 'list',
      },
    ],
    cannot_watch: [],
    understood:
      'The builder will text you each week with highlights of what shipped, its best idea and what is waiting on you.',
  },
  [WITH_GAP]: {
    watches: [
      {
        key: 'readings_finished',
        about: 'Learn readings you finished',
        tables: ['learn.readings'],
        mode: 'each',
        every_days: 1,
        repeat_after_days: null,
        form: null,
      },
    ],
    cannot_watch: ['your sister’s birthday'],
    understood: 'Your study buddy will text you as you finish each Learn reading.',
  },
};

/** A client that answers with the recorded reply for the brief it is sent, as structured output does. */
function recorded(reply?: unknown, extra: Record<string, unknown> = {}) {
  const create = vi.fn(async (params: { messages: { content: string }[] }) => {
    const prompt = params.messages[0].content;
    const brief = prompt.slice(prompt.indexOf('What they wrote:\n') + 'What they wrote:\n'.length);
    const json = reply === undefined ? REPLIES[brief] : reply;
    return {
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1_400, output_tokens: 600 },
      ...extra,
    };
  });
  return { create, client: { messages: { create } } as never };
}

async function make(name: string, brief: string, reply?: unknown, extra?: Record<string, unknown>) {
  const { client, create } = recorded(reply, extra);
  const spent: unknown[] = [];
  const made = await makeReachOutRule({ name, brief }, { client, onSpend: (r) => spent.push(r) });
  return { made, create, spent };
}

describe('the tables a rule may watch', () => {
  it('are all in the sources catalogue', () => {
    const catalogued = new Set([...SOURCES, ...NOT_SOURCES].map((s) => s.table));
    expect(REACH_OUT_TABLES.map((t) => t.table).filter((t) => !catalogued.has(t))).toEqual([]);
  });

  it('are the only tables the reply schema allows', () => {
    const tables = REACH_OUT_REPLY_SCHEMA.properties.watches.items.properties.tables.items.enum;
    expect([...tables]).toEqual(REACH_OUT_TABLES.map((t) => t.table));
  });
});

describe('makeReachOutRule', () => {
  it('asks for structured output, not a tool, and reports the spend', async () => {
    const { made, create, spent } = await make('Jerwyn the Elder', JERWYN);
    expect(made.ok).toBe(true);
    const params = create.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
    expect(params.output_config).toMatchObject({ format: { type: 'json_schema', schema: REACH_OUT_REPLY_SCHEMA } });
    expect(spent).toHaveLength(1);
  });

  it('makes the hiring manager’s rule: leads as they come, a weekly round-up, a contact never repeated', async () => {
    const { made } = await make('The hiring manager', HIRING_MANAGER);
    if (!made.ok) throw new Error(made.error);
    const byKey = Object.fromEntries(made.rule.watches.map((w) => [w.key, w]));
    expect(byKey.new_roles).toMatchObject({ mode: 'each', every_days: 1, repeat_after_days: null });
    expect(byKey.new_roles.form).toBeUndefined();
    expect(byKey.application_news).toMatchObject({
      tables: ['job_search.application_events'],
      mode: 'roundup',
      every_days: 7,
      form: 'list',
    });
    expect(byKey.person_to_contact).toMatchObject({ tables: ['job_search.contacts'], mode: 'pick', repeat_after_days: null });
    expect(made.rule.cannot_watch).toBeUndefined();
    expect(made.summary).toMatch(/^The hiring manager will text you/);
  });

  it('makes Jerwyn’s rule: advice from insights and notes every fortnight, not repeated for 30 days', async () => {
    const { made } = await make('Jerwyn the Elder', JERWYN);
    if (!made.ok) throw new Error(made.error);
    expect(made.rule).toEqual({
      version: 1,
      watches: [
        {
          key: 'wise_advice',
          about: 'Advice from your insights and new notes',
          tables: ['you.insights', 'obsidian.notes'],
          mode: 'roundup',
          every_days: 14,
          repeat_after_days: 30,
          form: 'bubbles',
        },
      ],
    });
    expect(made.summary).toContain('once a fortnight');
  });

  it('makes the builder’s rule: shipped, ideas and what waits on you, weekly', async () => {
    const { made } = await make('The builder', BUILDER);
    if (!made.ok) throw new Error(made.error);
    expect(made.rule.watches.map((w) => [w.key, w.tables[0], w.every_days])).toEqual([
      ['shipped', 'public.plan_items', 7],
      ['best_ideas', 'public.ideas', 7],
      ['waiting_on_you', 'public.plan_items', 7],
    ]);
    expect(made.rule.watches.find((w) => w.key === 'waiting_on_you')?.repeat_after_days).toBe(7);
  });

  it('keeps what it can watch and names what it cannot', async () => {
    const { made } = await make('Study buddy', WITH_GAP);
    if (!made.ok) throw new Error(made.error);
    expect(made.rule.watches.map((w) => w.key)).toEqual(['readings_finished']);
    expect(made.rule.cannot_watch).toEqual(['your sister’s birthday']);
    expect(made.summary).toContain('Dash cannot watch your sister’s birthday');
  });

  it('refuses a reply that is not JSON', async () => {
    const { made } = await make('Jerwyn the Elder', JERWYN, 'Sure! Here is the rule: every two weeks.');
    expect(made).toEqual({ ok: false, error: expect.stringContaining('Your words are kept') });
  });

  it('refuses a reply with a rule the database would refuse', async () => {
    const bad = structuredClone(REPLIES[JERWYN]) as { watches: Record<string, unknown>[] };
    bad.watches[0].every_days = 400;
    const { made } = await make('Jerwyn the Elder', JERWYN, bad);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error).toContain('every_days');
  });

  it('refuses a cut-off or declined reply', async () => {
    expect((await make('J', JERWYN, undefined, { stop_reason: 'max_tokens' })).made.ok).toBe(false);
    expect((await make('J', JERWYN, undefined, { stop_reason: 'refusal' })).made.ok).toBe(false);
  });

  it('never calls the model for an empty or overlong brief', async () => {
    const empty = await make('J', '   ');
    expect(empty.made.ok).toBe(false);
    expect(empty.create).not.toHaveBeenCalled();
    const long = await make('J', 'x'.repeat(2_001));
    expect(long.made.ok).toBe(false);
    expect(long.create).not.toHaveBeenCalled();
  });

  it('returns an error rather than throwing when the call fails', async () => {
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('network')) } } as never;
    const made = await makeReachOutRule({ name: 'J', brief: JERWYN }, { client });
    expect(made.ok).toBe(false);
  });
});

describe('readReachOutReply', () => {
  it('moves a watch on a table Dash cannot watch to cannot_watch', () => {
    const reply = structuredClone(REPLIES[JERWYN]) as { watches: Record<string, unknown>[] };
    reply.watches.push({ ...reply.watches[0], key: 'spend', about: 'What you spent', tables: ['core.model_spend'] });
    const made = readReachOutReply(reply);
    if (!made.ok) throw new Error(made.error);
    expect(made.rule.watches.map((w) => w.key)).toEqual(['wise_advice']);
    expect(made.rule.cannot_watch).toEqual(['What you spent']);
  });

  it('refuses a rule with nothing it can watch, naming the asks', () => {
    const made = readReachOutReply({ watches: [], cannot_watch: ['the weather'], understood: 'x' });
    expect(made).toEqual({ ok: false, uncovered: true, error: 'Dash cannot watch anything you asked for: the weather.' });
  });
});

// Plan #3030.3: the asks that used to come back as cannot_watch.
const kindWatch = (over: Record<string, unknown>) => ({
  key: 'w',
  about: 'x',
  kind: null,
  params: { words: null, amount: null, days: null, from: null },
  tables: [],
  mode: 'roundup',
  every_days: 1,
  repeat_after_days: null,
  form: 'list',
  always: false,
  ...over,
});

describe('fixed watch kinds in a reply', () => {
  it("makes Newt's news from the past 24 hours each morning a daily news round-up", () => {
    const made = readReachOutReply({
      watches: [kindWatch({ key: 'morning_news', about: 'the news from the past 24 hours', kind: 'news_issues' })],
      cannot_watch: [],
      understood: 'Newt the Newsboy will text you each morning with a summary of the news from the past 24 hours.',
    });
    if (!made.ok) throw new Error(made.error);
    expect(made.rule.watches).toEqual([
      {
        key: 'morning_news',
        about: 'the news from the past 24 hours',
        kind: 'news_issues',
        tables: ['news.issues'],
        mode: 'roundup',
        every_days: 1,
        repeat_after_days: null,
        form: 'list',
      },
    ]);
    expect(made.rule.cannot_watch).toBeUndefined();
  });

  it('keeps the amount, topic and days it was told, and a summary either way', () => {
    const made = readReachOutReply({
      watches: [
        kindWatch({ key: 'big_charges', kind: 'charge_over', mode: 'each', form: null, params: { words: ['x'], amount: 2000, days: null, from: null } }),
        kindWatch({ key: 'ai_news', kind: 'news_topics', params: { words: ['AI'], amount: null, days: null, from: null }, always: true }),
        kindWatch({ key: 'returns', kind: 'return_window', every_days: 1, params: { words: null, amount: null, days: null, from: null } }),
      ],
      cannot_watch: [],
      understood: 'Ok.',
    });
    if (!made.ok) throw new Error(made.error);
    const byKey = Object.fromEntries(made.rule.watches.map((w) => [w.key, w]));
    expect(byKey.big_charges).toMatchObject({ kind: 'charge_over', tables: ['finances.transactions'], params: { amount: 2000 } });
    expect(byKey.big_charges.params).toEqual({ amount: 2000 });
    expect(byKey.ai_news).toMatchObject({ params: { words: ['AI'] }, always: true });
    expect(byKey.returns.params).toEqual({ days: 7 });
  });

  it('sends a kind missing what it needs to cannot_watch, where a custom watch picks it up', () => {
    const made = readReachOutReply({
      watches: [
        kindWatch({ key: 'news', kind: 'news_issues' }),
        kindWatch({ key: 'charges', about: 'big charges', kind: 'charge_over' }),
      ],
      cannot_watch: [],
      understood: 'Ok.',
    });
    if (!made.ok) throw new Error(made.error);
    expect(made.rule.watches.map((w) => w.key)).toEqual(['news']);
    expect(made.rule.cannot_watch).toEqual(['big charges']);
  });

  it('offers every kind in the reply schema and the prompt', async () => {
    const { REACH_OUT_KINDS } = await import('@/lib/you/reach-out-kinds');
    const { REACH_OUT_RULES } = await import('@/lib/you/reach-out-make');
    const kinds = REACH_OUT_REPLY_SCHEMA.properties.watches.items.properties.kind.anyOf[0].enum;
    expect([...kinds]).toEqual(REACH_OUT_KINDS.map((k) => k.kind));
    for (const k of REACH_OUT_KINDS) expect(REACH_OUT_RULES).toContain(`- ${k.kind} (`);
  });
});

describe('reachOutSummary', () => {
  it('stays inside the 600 characters the column allows, gaps included', () => {
    const summary = reachOutSummary('a'.repeat(700), ['one thing', 'another']);
    expect(summary.length).toBeLessThanOrEqual(600);
    expect(summary).toMatch(/Dash cannot watch one thing and another, so they will not text about it\.$/);
  });
});

describe('saveReachOut', () => {
  function fakeClient() {
    const update = vi.fn();
    const chain = { eq: vi.fn() };
    chain.eq.mockReturnValueOnce(chain).mockReturnValueOnce(Promise.resolve({ error: null }));
    update.mockReturnValue(chain);
    return { update, chain, client: { from: vi.fn(() => ({ update })) } as unknown as YouSupabaseClient };
  }

  it('keeps the brief and the reason, with no rule, when the rule was refused', async () => {
    const { client, update, chain } = fakeClient();
    await saveReachOut(client, 'user-1', 'adv-1', ' Sum up advice ', { ok: false, error: 'Dash wrote no rule.' });
    expect(update.mock.calls[0][0]).toMatchObject({
      reach_out_brief: 'Sum up advice',
      reach_out_rule: null,
      reach_out_summary: null,
      reach_out_error: 'Dash wrote no rule.',
    });
    expect(chain.eq.mock.calls).toEqual([
      ['user_id', 'user-1'],
      ['id', 'adv-1'],
    ]);
  });

  it('saves a rule with its summary and clears the error', async () => {
    const { client, update } = fakeClient();
    const made = readReachOutReply(REPLIES[JERWYN]);
    await saveReachOut(client, 'user-1', 'adv-1', JERWYN, made);
    expect(update.mock.calls[0][0]).toMatchObject({ reach_out_error: null, reach_out_summary: expect.any(String) });
    expect(update.mock.calls[0][0].reach_out_rule.version).toBe(1);
  });

  it('clears everything for an empty brief', async () => {
    const { client, update } = fakeClient();
    await saveReachOut(client, 'user-1', 'adv-1', '', null);
    expect(update.mock.calls[0][0]).toEqual({
      reach_out_brief: null,
      reach_out_rule: null,
      reach_out_summary: null,
      reach_out_error: null,
      reach_out_set_at: null,
    });
  });
});
