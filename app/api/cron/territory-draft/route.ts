import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createServiceSupabase as createJobsServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { catalogueSql } from '@/lib/learn/catalogue/connection';
import { areaProblem, areaTerritory, type Territory } from '@/lib/learn/levels/territory';
import { loadSubjectTerritory } from '@/lib/learn/prepare/store';
import { TERRITORIES } from '@/lib/learn/levels/territories';
import { draftTerritoryTick } from '@/lib/learn/levels/territory-run';

// Two or three topics a call, each a pair of drafting calls side by side.
export const maxDuration = 300;

const BUDGET_MS = 240_000;
const ownerSchema = z.object({ userId: z.string() });
const subjectSchema = z.string().uuid();

/** The catalogue connection, or none on a deployment without DATABASE_URL. */
function catalogueOrNone() {
  try {
    return catalogueSql();
  } catch (err) {
    console.error('[territory-draft] no catalogue connection', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Drafts a territory from its sources (plan #2172.6), for the owner, the
 * account the dev tooling runs as. `?territory=saas-metrics` drafts the
 * hand-written fixture, and `&area=<area>` drafts only that area's topics not
 * yet drafted (plan #2483.1), or, for an area listed as a territory of its
 * own, that territory (`?territory=business&area=saas` drafts saas-metrics,
 * plan #2483.3); `?subject=<id>` drafts the territory that subject's
 * preparation compiled from its stored documents (plan #2276.4). Call it until
 * `remaining` is zero; each call picks up the topics not yet drafted. Every
 * topic lands as a draft with its five checks, for the person to approve on
 * /learn/topics.
 *
 * Fired by hand, never on a clock, because every call spends: with
 * `Authorization: Bearer $CRON_SECRET`, like the other cron routes, or from
 * SQL through pg_net with the secret from Vault.
 *
 * The catalogue connection lets the tick read the structure store and, on
 * the first tick, pull what the goal's kind calls for (plan #2247.10); a
 * deployment without one drafts from the territory's own sources.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const subjectParam = request.nextUrl.searchParams.get('subject');
  const key = request.nextUrl.searchParams.get('territory') ?? '';
  const subject = subjectParam === null ? null : subjectSchema.safeParse(subjectParam);
  if (subject && !subject.success) return NextResponse.json({ error: 'subject must be an id' }, { status: 400 });
  let area = request.nextUrl.searchParams.get('area') || undefined;
  let fixture = Object.hasOwn(TERRITORIES, key) ? TERRITORIES[key] : undefined;
  // An area that is a territory of its own, such as the business pack's
  // saas area, drafts that territory whole (plan #2483.3).
  const linked = fixture && area !== undefined ? areaTerritory(fixture, area) : null;
  if (linked) {
    fixture = Object.hasOwn(TERRITORIES, linked) ? TERRITORIES[linked] : undefined;
    area = undefined;
  }
  if (!subject && !fixture) return NextResponse.json({ error: `no territory "${key}"` }, { status: 404 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  try {
    const { data } = await createServiceSupabase().rpc('app_owner');
    const owner = ownerSchema.safeParse(data);
    if (!owner.success) return NextResponse.json({ error: 'no owner account' }, { status: 500 });
    const learn = createLearnServiceSupabase();
    let territory: Territory | null = fixture ?? null;
    if (subject?.success) {
      territory = await loadSubjectTerritory(learn, owner.data.userId, subject.data);
      if (!territory) return NextResponse.json({ error: 'that subject has no compiled territory yet' }, { status: 404 });
    }
    if (!territory) return NextResponse.json({ error: `no territory "${key}"` }, { status: 404 });
    const problem = area === undefined ? null : areaProblem(territory, area);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const summary = await draftTerritoryTick(
      { learn, jobs: createJobsServiceSupabase() },
      owner.data.userId,
      territory,
      { anthropicApiKey: apiKey, budgetMs: BUDGET_MS, catalogue: catalogueOrNone(), area },
    );
    return NextResponse.json({ ok: true, territory: territory.key, ...(area ? { area } : {}), ...summary });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
