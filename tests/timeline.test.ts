/**
 * core.timeline (plan #1117): one list of what you did across the modules,
 * read from the rows they already keep. Read as the signed-in person, it
 * returns their events from every module, and nothing of anyone else's.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import { TIMELINE_KINDS, TIMELINE_MODULES, eventRef, timelineHref, withRefs, type TimelineEvent, type TimelineRow } from '@/lib/timeline/timeline';
import { admin, asUser, closeDb, createUser, truncateAll } from './helpers/db';

let userA: string;
let userB: string;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** One of everything the view reads, for one person, dated oldest to newest. */
async function seed(userId: string, tag: string): Promise<void> {
  await admin`update core.account_settings set timezone = 'America/New_York' where user_id = ${userId}`;

  // Shopping: an order and its return.
  const [merchant] = await admin<{ id: string }[]>`
    insert into public.merchants (name, slug, created_by_user_id)
    values (${`${tag} Shop`}, ${`${tag}-shop`}, ${userId}) returning id`;
  const [order] = await admin<{ id: string }[]>`
    insert into public.orders (user_id, merchant_id, order_date, total_cents, currency)
    values (${userId}, ${merchant.id}, ${ago(40).toISOString().slice(0, 10)}, 4200, 'USD') returning id`;
  await admin`
    insert into public.orders (user_id, merchant_id, order_date, total_cents, currency, deleted_at)
    values (${userId}, ${merchant.id}, ${ago(40).toISOString().slice(0, 10)}, 999, 'USD', now())`;
  await admin`
    insert into public.returns (user_id, order_id, initiated_at, refund_amount_cents)
    values (${userId}, ${order.id}, ${ago(35).toISOString().slice(0, 10)}, 4200)`;

  // Jobs: applied, interviewed, rejected.
  const [company] = await admin<{ id: string }[]>`
    insert into job_search.companies (user_id, slug, name)
    values (${userId}, ${`${tag}-co`}, ${`${tag} Co`}) returning id`;
  const [role] = await admin<{ id: string }[]>`
    insert into job_search.roles (user_id, company_id, title)
    values (${userId}, ${company.id}, 'Analyst') returning id`;
  const [application] = await admin<{ id: string }[]>`
    insert into job_search.applications (user_id, role_id, rejection_stage_override)
    values (${userId}, ${role.id}, 'hiring_manager') returning id`;
  await admin`
    insert into job_search.application_events (user_id, application_id, kind, occurred_at, source, summary)
    values (${userId}, ${application.id}, 'submitted', ${ago(30)}, 'manual', 'applied'),
           (${userId}, ${application.id}, 'confirmation', ${ago(30)}, 'manual', 'not an event'),
           (${userId}, ${application.id}, 'rejection', ${ago(20)}, 'manual', 'rejected')`;
  const [group] = await admin<{ id: string }[]>`
    insert into job_search.interview_groups (user_id, application_id, label)
    values (${userId}, ${application.id}, 'screen') returning id`;
  await admin`
    insert into job_search.interviews (user_id, application_id, group_id, round, kind, scheduled_at, format)
    values (${userId}, ${application.id}, ${group.id}, 1, 'recruiter_screen', ${ago(25)}, 'video'),
           (${userId}, ${application.id}, ${group.id}, 2, 'recruiter_screen', ${new Date(Date.now() + 5 * DAY)}, 'video')`;

  // Todo: one done, one open.
  await admin`
    insert into todo.tasks (user_id, title, status, completed_at)
    values (${userId}, ${`${tag} task`}, 'done', ${ago(15)})`;
  await admin`insert into todo.tasks (user_id, title) values (${userId}, 'still open')`;

  // Vault: a note from the first sync, and one written since.
  const [connection] = await admin<{ id: string }[]>`
    insert into obsidian.vault_connections (user_id, repo_owner, repo_name, branch, backfill_completed_at)
    values (${userId}, 'me', ${`${tag}-vault`}, 'main', ${ago(60)}) returning id`;
  await admin`
    insert into obsidian.notes (user_id, connection_id, path, title, body, blob_sha, created_at)
    values (${userId}, ${connection.id}, 'old/Imported.md', 'Imported', 'x', 'a', ${ago(61)}),
           (${userId}, ${connection.id}, 'Journal/New note.md', 'New note', 'y', 'b', ${ago(10)})`;

  // Learn: a check answered and a reading finished.
  const [subject] = await admin<{ id: string }[]>`
    insert into learn.subjects (user_id, name) values (${userId}, ${`${tag} economics`}) returning id`;
  const [concept] = await admin<{ id: string }[]>`
    insert into learn.concepts (user_id, subject_id, name, claim, basis)
    values (${userId}, ${subject.id}, 'Phillips curve', 'claim', 'basis') returning id`;
  await admin`
    insert into learn.probes (user_id, concept_id, question, options, correct_index, reason, chosen_index, answered_at, weight)
    values (${userId}, ${concept.id}, 'q', ${admin.json(['a', 'b'])}, 1, 'because', 1, ${ago(8)}, 1.0)`;
  const [track] = await admin<{ id: string }[]>`
    insert into learn.tracks (user_id, title) values (${userId}, 'Macro') returning id`;
  await admin`
    insert into learn.readings (user_id, track_id, locator_basis, title, finished_at)
    values (${userId}, ${track.id}, 'basis', 'Chapter one', ${ago(6)})`;

  // Goals: a step closed under a goal.
  const [area] = await admin<{ id: string }[]>`
    insert into goals.areas (user_id, name) values (${userId}, 'Money') returning id`;
  const [goal] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, area_id, title)
    values (${userId}, 'goal', ${area.id}, ${`${tag} goal`}) returning id`;
  const [step] = await admin<{ id: string }[]>`
    insert into goals.items (user_id, level, parent_id, kind, title)
    values (${userId}, 'step', ${goal.id}, 'mine', 'List every balance') returning id`;
  await admin`insert into goals.items (user_id, level, parent_id, kind, title)
    values (${userId}, 'step', ${goal.id}, 'mine', 'Keeps the goal open')`;
  await admin`update goals.items set status = 'done' where id = ${step.id}`;
}

async function readAs(userId: string): Promise<TimelineEvent[]> {
  const rows = await asUser(userId, (tx) => tx<TimelineRow[]>`
    select occurred_at, module, kind, title, detail, amount_cents, currency, source_table, source_id, link_ref
    from core.timeline order by occurred_at`);
  return withRefs(rows);
}

/** Whether an in-app path has a page under app/, dynamic segments included. */
function routeExists(href: string): boolean {
  const segments = href.split('#')[0].split('/').filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0) return existsSync(path.join(dir, 'page.tsx'));
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === rest[0] && walk(full, rest.slice(1))) return true;
      if (/^\(.*\)$/.test(entry.name) && walk(full, rest)) return true;
      if (/^\[\.\.\..*\]$/.test(entry.name) && existsSync(path.join(full, 'page.tsx'))) return true;
      if (/^\[[^.].*\]$/.test(entry.name) && walk(full, rest.slice(1))) return true;
    }
    return false;
  };
  return walk(path.join(process.cwd(), 'app'), segments);
}

beforeAll(async () => {
  await truncateAll();
  userA = await createUser('timeline-a@example.com');
  userB = await createUser('timeline-b@example.com');
  await seed(userA, 'alpha');
  await seed(userB, 'beta');
});

afterAll(async () => {
  await truncateAll();
  await closeDb();
});

describe('core.timeline', () => {
  it('returns events from every module, in date order', async () => {
    const events = await readAs(userA);
    expect(new Set(events.map((e) => e.module))).toEqual(new Set(TIMELINE_MODULES));
    expect(events.map((e) => e.kind)).toEqual([
      'ordered',
      'returned',
      'applied',
      'interviewed',
      'rejected',
      'task_done',
      'note_written',
      'probe_answered',
      'reading_finished',
      'step_done',
    ]);
    const times = events.map((e) => new Date(e.occurred_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('holds only kinds the app knows, under their own module', async () => {
    for (const event of await readAs(userA)) {
      expect(TIMELINE_KINDS[event.module] as readonly string[]).toContain(event.kind);
    }
  });

  it('shows nothing belonging to another person', async () => {
    const a = await readAs(userA);
    const b = await readAs(userB);
    expect(a.some((e) => e.title.includes('beta'))).toBe(false);
    expect(b.some((e) => e.title.includes('alpha'))).toBe(false);
    const refsA = new Set(a.map(eventRef));
    expect(b.filter((e) => refsA.has(eventRef(e)))).toEqual([]);
  });

  it('reads nothing for a visitor who is not signed in', async () => {
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role anon');
      return tx`select count(*) from core.timeline`;
    })).rejects.toThrow(/permission denied/);
  });

  it('carries what later steps need: the money, the stage, the goal', async () => {
    const events = await readAs(userA);
    const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
    expect(byKind.ordered).toMatchObject({ title: 'alpha Shop', amount_cents: 4200, currency: 'USD' });
    expect(byKind.returned).toMatchObject({ amount_cents: 4200 });
    expect(byKind.rejected).toMatchObject({ title: 'Analyst at alpha Co', detail: 'hiring manager' });
    expect(byKind.step_done).toMatchObject({ title: 'List every balance', detail: 'alpha goal' });
    // A date-only row sits at noon where the person lives, so its day holds.
    const ordered = new Date(byKind.ordered.occurred_at);
    const local = ordered.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    expect(local).toBe('12');
  });

  it('reads a zone Postgres does not know as UTC rather than failing', async () => {
    await admin`update core.account_settings set timezone = 'Mars/Olympus' where user_id = ${userB}`;
    const events = await readAs(userB);
    const ordered = events.find((e) => e.kind === 'ordered')!;
    expect(new Date(ordered.occurred_at).getUTCHours()).toBe(12);
  });

  it('links every event to a page that exists', async () => {
    const events = await readAs(userA);
    for (const event of events) {
      const href = timelineHref(event);
      expect(href, `${event.kind} → ${href}`).not.toBe('/');
      expect(routeExists(href), `${event.kind} → ${href}`).toBe(true);
    }
    const step = events.find((e) => e.kind === 'step_done')!;
    expect(timelineHref(step)).toBe(`/goals/${step.link_ref}/s/${step.source_id}`);
    const note = events.find((e) => e.kind === 'note_written')!;
    expect(timelineHref(note)).toBe('/vault/n/Journal/New%20note.md');
  });

  it('names every event by a ref to a row of its own person', async () => {
    const events = await readAs(userA);
    // The seed holds an event from every module (the first test above).
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(parseRef(event.ref), event.ref).toMatchObject({ table: event.source_table, id: event.source_id });
      const [{ owned }] = await admin<{ owned: boolean }[]>`select core.ref_owned(${event.ref}, ${userA}) as owned`;
      expect(owned, event.ref).toBe(true);
    }
  });
});
