/**
 * The close guard for a step that changed a screen (plan #1534,
 * docs/UI-QUALITY-SPEC.md R4).
 *
 * A step whose commits change a `.tsx` file under `app/` or `components/`
 * cannot be closed until every gallery surface those files serve has passed
 * the design critic, as recorded in `public.ui_checks`. `scripts/plan.ts done`
 * runs it before writing the close, and `npm run ui-guard -- <n>` runs it for
 * a session closing through the Supabase connector (offline.md).
 *
 * What counts is each surface's latest round. A pass followed by a later
 * round asking for fixes (the screen was re-shot after wiring) is not a pass
 * any more, and a later round that passes settles an earlier failure.
 *
 * This file has no side effects: git is passed in as a function, and the
 * rounds are passed in as rows, so the rule is tested without either.
 */

/**
 * Verdicts that let a surface through: the critic's `pass`, and `accepted`,
 * which the person writes from /dev/plan for a screen they let through after
 * the critic's last round (plan #1610, migration 0175). The critic never
 * writes `accepted`.
 */
export const PASSING_VERDICTS: readonly string[] = ['pass', 'accepted'];

/** One recorded round, as much of a `ui_checks` row as the guard reads. */
export type CheckRound = { surface: string; round: number; verdict: string };

/** A surface that has not passed, and the last thing on record for it. */
export type UnpassedSurface = {
  surface: string;
  /** The latest round recorded, or null when there is none. */
  round: number | null;
  verdict: string | null;
};

/** Runs git with these arguments and returns its stdout; throws when git fails. */
export type GitRunner = (args: string[]) => string;

/** A file that draws a screen: a `.tsx` under `app/` or `components/`, not a test or the gallery. */
export function isScreenFile(file: string): boolean {
  const path = file.replace(/^\.\//, '');
  if (!path.endsWith('.tsx') || /\.test\.tsx$/.test(path)) return false;
  if (path.startsWith('app/preview/')) return false;
  return path.startsWith('app/') || path.startsWith('components/');
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The files a step changed, read from git.
 *
 * Two places, joined: the commit the close records, and every commit on its
 * history whose subject ends `(plan #<n>)`. The commit a close records is
 * usually the merge that put the step on main, and a merge lists no files of
 * its own, so a merge is read against its first parent, which is everything
 * the branch brought in. The subject search catches a step whose close
 * records a later commit than its own.
 *
 * Throws when git cannot read the commit: a guard that cannot see the files
 * must not wave the close through.
 */
export function filesOfStep(step: number, commit: string, git: GitRunner): string[] {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error(`"${commit}" is not a commit sha.`);
  const parents = lines(git(['rev-list', '--parents', '-n', '1', commit]))[0]?.split(/\s+/) ?? [];
  if (parents.length === 0) throw new Error(`git does not know commit ${commit}.`);
  const own =
    parents.length > 2
      ? git(['diff', '--name-only', `${commit}^1`, commit])
      : git(['show', '--name-only', '--format=', commit]);
  const tagged = git([
    'log',
    commit,
    '--no-merges',
    '--fixed-strings',
    `--grep=(plan #${step})`,
    '--name-only',
    '--format=',
  ]);
  return [...new Set([...lines(own), ...lines(tagged)])].sort();
}

/**
 * The surfaces in `surfaces` whose latest recorded round is not a passing
 * one, in the order given.
 */
export function unpassedSurfaces(
  surfaces: readonly string[],
  checks: readonly CheckRound[],
): UnpassedSurface[] {
  const latest = new Map<string, CheckRound>();
  for (const check of checks) {
    const seen = latest.get(check.surface);
    if (!seen || check.round > seen.round) latest.set(check.surface, check);
  }
  const out: UnpassedSurface[] = [];
  for (const surface of surfaces) {
    const last = latest.get(surface);
    if (last && PASSING_VERDICTS.includes(last.verdict)) continue;
    out.push({ surface, round: last?.round ?? null, verdict: last?.verdict ?? null });
  }
  return out;
}

function describe(missing: UnpassedSurface): string {
  if (missing.round === null) return `${missing.surface} (no round recorded)`;
  return `${missing.surface} (round ${missing.round} asked for fixes)`;
}

/**
 * Why `done` refuses this step, or null when it may close.
 *
 * `files` are the step's changed files (`filesOfStep`) and `surfaces` the
 * gallery surfaces they serve (`surfacesForFiles` with importers). A step
 * that changed no screen file closes as before. A screen file that no
 * surface stands for has nothing to check here; R1's count of pages without
 * a surface is what drives those down.
 */
export function uiCheckRefusal(input: {
  step: number;
  files: readonly string[];
  surfaces: readonly string[];
  checks: readonly CheckRound[];
}): string | null {
  if (!input.files.some(isScreenFile)) return null;
  const missing = unpassedSurfaces(input.surfaces, input.checks);
  if (missing.length === 0) return null;
  const which = missing.map(describe).join(', ');
  const first = missing[0];
  const next = (first.round ?? 0) + 1;
  return (
    `#${input.step} changed a screen, and the design critic has not passed ` +
    `${missing.length === 1 ? 'its surface' : `${missing.length} of its surfaces`}: ${which}. ` +
    `Run the critic on ${missing.length === 1 ? 'it' : 'each'} and record the round ` +
    `(npm run ui-check -- ${input.step} ${first.surface} ${next}), then close it once it passes. ` +
    `building.md, "Building a screen", has the loop.`
  );
}

/**
 * The statement a session closing through the Supabase connector runs to
 * apply the same rule. It returns one row per surface that has not passed,
 * with the latest round and verdict, so no rows means the step may close.
 * The verdict list comes from `PASSING_VERDICTS`, so the two cannot drift.
 */
export function uiGuardSql(step: number, surfaces: readonly string[], userId?: string): string {
  if (userId !== undefined && !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error(`"${userId}" is not a user id.`);
  }
  if (!Number.isInteger(step) || step < 1) throw new Error(`"${step}" is not a step number.`);
  for (const s of surfaces) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(s)) throw new Error(`"${s}" is not a surface id.`);
  }
  if (surfaces.length === 0) return '';
  const list = surfaces.map((s) => `'${s}'`).join(', ');
  const passing = PASSING_VERDICTS.map((v) => `'${v}'`).join(', ');
  // The step's owner, unless one is named: the rounds are the account's whose plan the step is on.
  const owner = userId
    ? `'${userId}'`
    : `(select p.user_id from plan_items p where p.number = ${step} limit 1)`;
  return [
    'select s.surface, last.round, last.verdict',
    `from unnest(array[${list}]::text[]) as s(surface)`,
    'left join lateral (',
    '  select c.round, c.verdict from ui_checks c',
    `  where c.user_id = ${owner} and c.step = ${step} and c.surface = s.surface`,
    '  order by c.round desc limit 1',
    ') last on true',
    `where last.verdict is null or last.verdict not in (${passing});`,
  ].join('\n');
}

/**
 * The person's answer to a design-check block, written down where the close
 * guard reads it (`npm run ui-guard -- <n> --accept`).
 *
 * The person answers a block on /dev/plan in words, and the answer lands on
 * the step's thread and as an `Answered <date>: …` line on its comment. The
 * guard reads only `ui_checks`, so an "Accept" there used to change nothing:
 * the next session hit the same surfaces and asked again (#1702 asked twice).
 * This writes one `accepted` round for each surface that has not passed,
 * numbered on from its last round, with the answer quoted in the notes.
 *
 * It writes nothing unless the step's comment has an `Answered` line newer
 * than its last `Blocked` line: the person has to have answered the block
 * this is about, so a session cannot accept its own screens. Reading that
 * answer as an accept, rather than as what to change, is the session's call,
 * made by the rule in building.md.
 */
export function uiAcceptSql(step: number, surfaces: readonly string[]): string {
  const check = uiGuardSql(step, surfaces);
  if (!check) return '';
  const list = surfaces.map((s) => `'${s}'`).join(', ');
  const passing = PASSING_VERDICTS.map((v) => `'${v}'`).join(', ');
  return [
    'with step as (',
    '  select p.user_id, p.comment,',
    "    substring(p.comment from '.*(Answered [0-9-]+: [^\\n]*)') as answer",
    `  from plan_items p where p.number = ${step}`,
    // The newest Answered line comes after the newest Blocked line.
    "    and strpos(reverse(p.comment), reverse('Answered ')) > 0",
    "    and (strpos(reverse(p.comment), reverse('Blocked ')) = 0",
    "      or strpos(reverse(p.comment), reverse('Answered ')) < strpos(reverse(p.comment), reverse('Blocked ')))",
    '  limit 1',
    '), waiting as (',
    '  select s.surface, coalesce(last.round, 0) + 1 as round',
    `  from unnest(array[${list}]::text[]) as s(surface)`,
    '  cross join step',
    '  left join lateral (',
    '    select c.round, c.verdict from ui_checks c',
    `    where c.user_id = step.user_id and c.step = ${step} and c.surface = s.surface`,
    '    order by c.round desc limit 1',
    '  ) last on true',
    `  where last.verdict is null or last.verdict not in (${passing})`,
    ')',
    'insert into ui_checks (user_id, step, surface, round, verdict, fixes, earlier, notes, shots)',
    `select step.user_id, ${step}, waiting.surface, waiting.round, 'accepted', '[]'::jsonb, '[]'::jsonb,`,
    "  'Accepted by you: ' || step.answer, '{}'::text[]",
    'from waiting cross join step',
    'returning surface, round;',
  ].join('\n');
}
