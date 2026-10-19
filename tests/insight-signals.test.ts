/**
 * The nightly insight numbers and tripwires, against Postgres (plan #2413.7).
 *
 * you.compute_insight_signals (supabase/migrations-you/0012) writes one row a
 * day into you.insight_signals and checks every tripwire on a shown insight.
 * Each signal and each tripwire kind is checked here against fixture rows for
 * one person, with a second person whose rows must never be counted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, closeDb, createUser, truncateAll } from './helpers/db-you';

// 10:00 in New York on Sunday 18 October 2026.
const NOW = '2026-10-18T14:00:00Z';
const CRYPTO_WORDS = { Crypto: ['crypto', 'web3', 'blockchain'] };

let me = '';
let other = '';
let insightId = '';
let goalId = '';
const tripwire: Record<string, string> = {};

type Signals = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function company(userId: string, name: string, industry: string | null) {
  const [row] = await admin<{ id: string }[]>`
    insert into job_search.companies (user_id, name, slug, industry)
    values (${userId}, ${name}, ${name.toLowerCase().replace(/\W+/g, '-')}, ${industry}) returning id`;
  return row.id;
}

async function application(
  userId: string,
  companyId: string,
  title: string,
  fields: { status: string; submitted_at?: string; created_at?: string; closed_at?: string; outcome?: string; rejection_stage?: string },
) {
  const [role] = await admin<{ id: string }[]>`
    insert into job_search.roles (user_id, company_id, title) values (${userId}, ${companyId}, ${title}) returning id`;
  const [row] = await admin<{ id: string }[]>`
    insert into job_search.applications (user_id, role_id, status, submitted_at, created_at, closed_at, outcome, rejection_stage)
    values (${userId}, ${role.id}, ${fields.status}::job_search.application_status, ${fields.submitted_at ?? null},
            ${fields.created_at ?? fields.submitted_at ?? NOW}, ${fields.closed_at ?? null},
            ${fields.outcome ?? null}::job_search.application_outcome,
            ${fields.rejection_stage ?? null}::job_search.rejection_stage)
    returning id`;
  // The status sync trigger may move the status from events; put it back.
  await admin`update job_search.applications set status = ${fields.status}::job_search.application_status where id = ${row.id}`;
  return row.id;
}

async function view(userId: string, at: string, workspace: string | null, route = '/x') {
  await admin`insert into core.page_views (user_id, route, workspace, via, viewed_at)
              values (${userId}, ${route}, ${workspace}, 'navigation', ${at})`;
}

async function step(userId: string, title: string, fields: { kind?: string; due_on?: string } = {}) {
  const [row] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, parent_id, kind, title, status, due_on)
    values (${userId}, 'step', ${goalId}, ${fields.kind ?? 'mine'}, ${title}, 'open', ${fields.due_on ?? null}) returning id`;
  return row.id;
}

async function close(id: string, status: 'done' | 'dropped', actor: string, at: string) {
  await admin.begin(async (tx) => {
    await tx`select set_config('goals.actor', ${actor}, true)`;
    await tx`update goals.items set status = ${status} where id = ${id}`;
  });
  await admin`update goals.items set closed_at = ${at} where id = ${id}`;
  await admin`update goals.history set created_at = ${at}
              where row_id = ${id} and new_values ->> 'status' = ${status}`;
}

async function wire(kind: string, params: object, createdAt = '2026-10-01T12:00:00Z') {
  const [row] = await admin<{ id: string }[]>`
    insert into you.insight_tripwires (user_id, insight_id, kind, params, created_at)
    values (${me}, ${insightId}, ${kind}, ${admin.json(params as never)}, ${createdAt}) returning id`;
  return row.id;
}

async function compute(userId: string, now = NOW): Promise<Signals> {
  const [row] = await admin<{ s: Signals }[]>`
    select you.compute_insight_signals(${userId}::uuid, ${admin.json(CRYPTO_WORDS)}, ${now}::timestamptz) as s`;
  return row.s;
}

async function wireRow(id: string) {
  const [row] = await admin<{ last_fired_at: Date | null; last_checked_at: Date | null; fired_evidence: Signals | null }[]>`
    select last_fired_at, last_checked_at, fired_evidence from you.insight_tripwires where id = ${id}`;
  return row;
}

beforeAll(async () => {
  await truncateAll();
  me = await createUser('signals-me@example.com');
  other = await createUser('signals-other@example.com');

  await admin`update core.account_settings set timezone = 'America/New_York' where user_id = ${me}`;
  await admin`update job_search.profiles
              set target_titles = ${['FP&A', 'Chief of Staff']}, excluded_industries = ${['Crypto']}
              where id = ${me}`;

  // Rules: the thought that first names Crypto dates the rule.
  await admin`insert into job_search.thoughts (user_id, body, created_at) values
    (${me}, 'NOT: Crypto, Healthcare or Defense.', '2026-09-28T16:00:00Z'),
    (${me}, 'Part of me wants to start a startup.', '2026-10-05T05:00:00Z'),
    (${me}, 'Startups again: I could do what they do.', '2026-10-12T05:00:00Z'),
    (${me}, 'An old thought.', '2026-08-01T05:00:00Z')`;
  await admin`insert into goals.captures (user_id, body, created_at)
              values (${me}, 'Look into a startup idea', '2026-10-10T12:00:00Z')`;

  const acme = await company(me, 'Acme', 'Software');
  const chain = await company(me, 'Chainco', 'Web3 infrastructure');
  const beta = await company(me, 'Beta', null);
  await application(me, acme, 'Senior FP&A Analyst', { status: 'in_process', submitted_at: '2026-10-01T15:00:00Z' });
  await application(me, acme, 'Chief of Staff', { status: 'submitted', submitted_at: '2026-10-14T15:00:00Z' });
  await application(me, chain, 'Finance Lead', { status: 'submitted', submitted_at: '2026-10-16T15:00:00Z' });
  await application(me, beta, 'Operations Manager', {
    status: 'rejected', submitted_at: '2026-09-20T15:00:00Z', closed_at: '2026-09-25T15:00:00Z',
    outcome: 'rejected', rejection_stage: 'resume_review',
  });
  await application(me, beta, 'Old lead', { status: 'lead', created_at: '2026-09-20T15:00:00Z' });
  await application(me, beta, 'New lead', { status: 'lead', created_at: '2026-10-10T15:00:00Z' });

  // Build views on 15, 16 and 17 October, one other view, one at 2:30am.
  await view(me, '2026-10-15T16:00:00Z', 'dev');
  await view(me, '2026-10-16T16:00:00Z', 'dev');
  await view(me, '2026-10-16T17:00:00Z', 'dev');
  await view(me, '2026-10-17T16:00:00Z', 'dev');
  await view(me, '2026-10-17T18:00:00Z', 'jobs');
  await view(me, '2026-10-17T06:30:00Z', null);
  await view(me, '2026-10-01T16:00:00Z', 'dev'); // outside the seven days

  const [area] = await admin<{ id: string }[]>`
    insert into goals.areas (user_id, name) values (${me}, 'Career') returning id`;
  [{ id: goalId }] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, area_id, title, status, approved_at)
    values (${me}, 'goal', ${area.id}, 'Land a job', 'open', now()) returning id`;
  const mine = await step(me, 'Update the résumé');
  const dashs = await step(me, 'Find three contacts', { kind: 'claude' });
  await close(mine, 'done', 'me', '2026-10-16T12:00:00Z');
  await close(dashs, 'done', 'claude', '2026-10-02T12:00:00Z');
  await close(await step(me, 'Ask Gabe Stagner to vouch for you'), 'dropped', 'me', '2026-10-10T12:00:00Z');
  await close(await step(me, 'Choose and build the furniture'), 'dropped', 'me', '2026-10-10T12:00:00Z');
  await step(me, 'Send the cover letter', { due_on: '2026-10-16' });
  await step(me, 'Due long ago', { due_on: '2026-09-01' });

  await admin`insert into public.feedback_items (user_id, kind, body, created_at) values
    (${me}, 'bug', 'one', '2026-10-17T12:00:00Z'),
    (${me}, 'bug', 'two', '2026-09-01T12:00:00Z')`;

  [{ id: insightId }] = await admin<{ id: string }[]>`
    insert into you.insights (user_id, kind, claim, confidence)
    values (${me}, 'pattern', 'You build while you wait.', 'medium') returning id`;
  tripwire.building = await wire('building_while_waiting', {});
  tripwire.deadline = await wire('deadline_during_building', {});
  tripwire.rule = await wire('rule_broken', {});
  tripwire.want = await wire('want_recurring', { words: ['startup'] });
  tripwire.acted = await wire('want_recurring', { words: ['finance'] });

  // Someone else's rows, which must never be counted.
  await admin`update job_search.profiles set excluded_industries = ${['Crypto']} where id = ${other}`;
  const theirs = await company(other, 'Chainco', 'Web3');
  await application(other, theirs, 'FP&A Lead', { status: 'submitted', submitted_at: '2026-10-16T15:00:00Z' });
  await view(other, '2026-10-17T16:00:00Z', 'dev');
  await admin`insert into public.feedback_items (user_id, kind, body, created_at) values (${other}, 'bug', 'theirs', '2026-10-17T12:00:00Z')`;
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('you.compute_insight_signals (plan #2413.7)', () => {
  let s: Signals = {};

  beforeAll(async () => {
    s = await compute(me);
  });

  it('counts applications by role bucket and those past the screen', () => {
    expect(s.applications.submitted).toBe(4);
    expect(s.applications.past_screen).toBe(1);
    expect(s.applications.submitted_7d).toBe(2);
    expect(s.applications.by_bucket).toEqual({
      'FP&A': { submitted: 1, past_screen: 1 },
      'Chief of Staff': { submitted: 1, past_screen: 0 },
      other: { submitted: 2, past_screen: 0 },
    });
  });

  it('counts saved leads older than 14 days', () => {
    expect(s.saved_leads_stale).toBe(1);
  });

  it('counts steps closed by the person and by Dash', () => {
    expect(s.goal_steps_closed).toEqual({ you: 1, dash: 1, you_7d: 1, dash_7d: 0 });
  });

  it('counts dropped steps that ask someone for something', () => {
    expect(s.dropped_asks).toEqual({ total: 1, last_30d: 1 });
  });

  it('counts build views against the rest, and late-night views, in their timezone', () => {
    expect(s.views_7d).toEqual({ build: 4, other: 2, late_night: 1, build_days: 3 });
  });

  it('counts feedback filed and open deadlines passed', () => {
    expect(s.feedback_filed).toEqual({ total: 2, last_7d: 1 });
    expect(s.deadlines_passed).toEqual({ goal_items: 2, job_reminders: 0 });
  });

  it('counts job thoughts, rules, and applications breaking a rule written before them', () => {
    expect(s.job_thoughts).toEqual({ total: 4, last_30d: 3 });
    expect(s.rules.written).toBe(1);
    expect(s.rules.broken).toBe(1);
    expect(s.rules.broken_applications[0]).toMatchObject({ company: 'Chainco', role: 'Finance Lead', rule: 'Crypto' });
  });

  it('writes one row for the day in their timezone', async () => {
    const rows = await admin<{ day: string }[]>`
      select day::text from you.insight_signals where user_id = ${me}`;
    expect(rows).toEqual([{ day: '2026-10-18' }]);
  });

  it('checks every tripwire and fires the four kinds on the evidence', async () => {
    expect(s.tripwires.checked).toBe(5);
    const fired = (s.tripwires.fired as { kind: string; tripwire_id: string }[]).map((f) => f.tripwire_id).sort();
    expect(fired).toEqual([tripwire.building, tripwire.deadline, tripwire.rule, tripwire.want].sort());

    const building = await wireRow(tripwire.building);
    expect(building.fired_evidence?.build_days).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
    expect(building.fired_evidence?.waiting.map((w: { role: string }) => w.role)).toEqual(['Chief of Staff']);

    const deadline = await wireRow(tripwire.deadline);
    expect(deadline.fired_evidence?.deadlines).toEqual([
      expect.objectContaining({ title: 'Send the cover letter', day: '2026-10-16', build_views: 2 }),
    ]);

    const rule = await wireRow(tripwire.rule);
    expect(rule.fired_evidence?.applications).toHaveLength(1);

    const want = await wireRow(tripwire.want);
    expect(want.fired_evidence?.mentions.map((m: { source: string }) => m.source)).toEqual([
      'job_search.thoughts', 'goals.captures', 'job_search.thoughts',
    ]);

    const acted = await wireRow(tripwire.acted);
    expect(acted.last_fired_at).toBeNull();
    expect(acted.last_checked_at).not.toBeNull();
  });

  it('does not fire again on a second run the same day, and keeps the day\'s fired list', async () => {
    const before = await wireRow(tripwire.rule);
    const again = await compute(me, '2026-10-18T20:00:00Z');
    expect((await wireRow(tripwire.rule)).last_fired_at).toEqual(before.last_fired_at);
    expect(again.tripwires.fired).toHaveLength(4);
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from you.insight_signals where user_id = ${me}`;
    expect(n).toBe(1);
  });

  it('fires a rule tripwire only for an application sent after it last fired', async () => {
    const next = await compute(me, '2026-10-19T14:00:00Z');
    expect(next.tripwires.fired.map((f: { kind: string }) => f.kind)).not.toContain('rule_broken');
  });

  it('skips tripwires on insights no longer shown', async () => {
    await admin`update you.insights set status = 'retired' where id = ${insightId}`;
    const next = await compute(me, '2026-10-20T14:00:00Z');
    expect(next.tripwires.checked).toBe(0);
    await admin`update you.insights set status = 'shown' where id = ${insightId}`;
  });

  it('never counts another account', async () => {
    const theirs = await compute(other);
    expect(theirs.applications.submitted).toBe(1);
    expect(theirs.views_7d.build).toBe(1);
    expect(theirs.feedback_filed.total).toBe(1);
    expect(theirs.tripwires.checked).toBe(0);
  });
});
