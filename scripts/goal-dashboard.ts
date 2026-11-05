/**
 * The goals routine's side of a goal's dashboard (plan #2778.9;
 * .claude/skills/goals/reference/dashboards.md). A run lays a goal out here
 * rather than writing goals.items.dashboard in SQL, so the layout goes
 * through the same check as the page (saveGoalDashboard) and is recorded in
 * core.dash_actions, which lists it on the Goals home with an Undo.
 *
 *   npm run goals:dashboard -- open                     # open goals, and which have no layout
 *   npm run goals:dashboard -- show <goal id>           # what its tiles may read, and its layout now
 *   npm run goals:dashboard -- check <goal id> <file>   # check a layout without saving it
 *   npm run goals:dashboard -- save <goal id> <file> --run <run id>
 *                                                              # save it as the run's, with an Undo
 *
 * <file> holds the layout as JSON: a list of tiles, naming lists, metrics
 * and steps by name or id and fields by label or key. Every read and write is
 * for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY and the project
 * (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF).
 */
import { readFileSync } from 'node:fs';
import { supabaseProjectRef } from '../lib/db/project';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = supabaseProjectRef();
  if (ref) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused-by-the-service-role';

const OPEN = ['done', 'dropped'];

async function main() {
  const { createServiceSupabase, createServiceSchemaSupabase } = await import('@/inngest/supabase-admin');
  const { createGoalsServiceSupabase } = await import('@/inngest/goals/supabase-admin');
  const { checkLayout, parseLayout } = await import('@/lib/goals/dashboard');
  const { layoutWords, resolveTile, targetsContext } = await import('@/lib/goals/dashboard-names');
  const { loadDashboardTargets, saveGoalDashboard } = await import('@/lib/goals/dashboard-store');
  const { recordDashAction } = await import('@/lib/core/dash-actions');

  const args = process.argv.slice(2);
  const runAt = args.indexOf('--run');
  const runId = runAt >= 0 ? args[runAt + 1] : undefined;
  const [command, goalId, file] = runAt >= 0 ? [...args.slice(0, runAt), ...args.slice(runAt + 2)] : args;

  const { data: owner } = await createServiceSupabase().rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const goals = createGoalsServiceSupabase({ actor: 'claude', ...(runId ? { runId } : {}) });
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  if (command === 'open') {
    const { data, error } = await goals
      .from('items')
      .select('id, title, status, approved_at, dashboard')
      .eq('user_id', userId)
      .eq('level', 'goal')
      .is('archived_at', null)
      .order('position');
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as { id: string; title: string; status: string; approved_at: string | null; dashboard: unknown }[])
      .filter((g) => !OPEN.includes(g.status))
      .map((g) => ({ id: g.id, title: g.title, status: g.status, approved: g.approved_at !== null, tiles: Array.isArray(g.dashboard) ? g.dashboard.length : null }));
    print({ open: rows.length, withoutLayout: rows.filter((g) => g.tiles === null).length, goals: rows });
    return;
  }

  if (!goalId) throw new Error(`Usage: goal-dashboard ${command ?? '<open|show|check|save>'} <goal id> …`);
  const { data: goal, error } = await goals
    .from('items')
    .select('id, title, level, dashboard')
    .eq('id', goalId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!goal || (goal as { level: string }).level !== 'goal') throw new Error(`No goal ${goalId} for the owner.`);
  const before = (goal as { dashboard: unknown }).dashboard ?? null;
  const targets = await loadDashboardTargets(goals, userId, goalId);

  if (command === 'show') {
    const parsed = parseLayout(before);
    print({
      goal: { id: goalId, title: (goal as { title: string }).title },
      lists: targets.lists.map((l) => ({ name: l.name, id: l.id, fields: l.fields })),
      metrics: targets.metrics,
      steps: targets.steps,
      layout: before,
      reads: parsed.ok ? layoutWords(parsed.tiles, targets) : 'The saved layout no longer parses.',
    });
    return;
  }

  if (!file) throw new Error(`Usage: goal-dashboard ${command} <goal id> <file>`);
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('The file holds a list of at least one tile.');
  const tiles = raw.map((entry, index) => {
    const resolved = resolveTile(entry, targets);
    if (!resolved.ok) throw new Error(`Tile ${index + 1}: ${resolved.error}`);
    return resolved.tile;
  });

  if (command === 'check') {
    const checked = checkLayout(tiles, targetsContext(targets));
    print(checked.ok ? { ok: true, tiles: checked.tiles, reads: layoutWords(checked.tiles, targets) } : checked);
    return;
  }

  if (command !== 'save') throw new Error(`Unknown command ${command}. Use open, show, check or save.`);
  if (!runId) throw new Error('save needs --run <the goals.runs id>, so the change is the run’s.');
  const saved = await saveGoalDashboard(goals, userId, goalId, tiles);
  if (!saved.ok) {
    print(saved);
    process.exitCode = 1;
    return;
  }
  const { data: now } = await goals.from('items').select('dashboard').eq('id', goalId).eq('user_id', userId).single();
  const title = (goal as { title: string }).title.split('\n')[0].trim();
  const n = saved.value.length;
  const service = createServiceSchemaSupabase('core');
  const recorded = await recordDashAction(
    { userId, core: service as never, db: (async (schema: string) => createServiceSchemaSupabase(schema)) as never },
    {
      surface: 'routine',
      kind: 'change_goal_dashboard',
      subjectRef: `goals.items:${goalId}`,
      op: 'update',
      summary: `Dash laid out the dashboard of the goal "${title}" with ${n} tile${n === 1 ? '' : 's'}: ${layoutWords(saved.value, targets).replace(/^The dashboard has /, '')}`,
      beforeValues: { dashboard: before },
      afterValues: { dashboard: (now as { dashboard: unknown } | null)?.dashboard ?? null },
    },
  );
  print({ saved: n, tiles: saved.value, recorded });
  if (!recorded) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
