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
 * A step's rounds are its own and those recorded under every step beneath
 * it. A parent step or a feature row is built through its children, and the
 * critic judges each surface under the child that drew it; #2540 and #2879.1
 * could not close because the guard looked only at the parent's own number.
 *
 * This file has no side effects: git is passed in as a function, and the
 * rounds are passed in as rows, so the rule is tested without either.
 */

/**
 * Verdicts that let a surface through: the critic's `pass`, and `accepted`,
 * written for a screen let through after the critic's last round (plan
 * #1610, migration 0175): by the person from /dev/plan, or by the session
 * that built it (`uiSettleSql`), whose notes open "Settled by Dash". The
 * critic never writes `accepted`.
 */
export const PASSING_VERDICTS: readonly string[] = ['pass', 'accepted'];

/** One recorded round, as much of a `ui_checks` row as the guard reads. */
export type CheckRound = {
  surface: string;
  round: number;
  verdict: string;
  /**
   * The round's answer to "does the layout match the reference", when the
   * critic was asked (plan #2966.5): true for yes, false for no, null or
   * absent when the surface has no reference or the round predates the
   * question.
   */
  layout_ok?: boolean | null;
  /** The round's fixes as the critic wrote them, for the kinds only the person settles. */
  fixes?: unknown;
  /** The round's notes; a settle's open "Settled by Dash". */
  notes?: string | null;
};

/** A surface that has not passed, and the last thing on record for it. */
export type UnpassedSurface = {
  surface: string;
  /** The latest round recorded, or null when there is none. */
  round: number | null;
  verdict: string | null;
  /** True when the surface's latest layout answer is no, whatever its verdict says. */
  layoutNo?: true;
  /**
   * The kinds of fix in its latest judged round that only the person settles
   * (`PERSON_HELD_BREAKS`), when there are any.
   */
  askPerson?: string[];
};

/**
 * The kinds of fix a session does not settle (plan #2966.4): the screen reads
 * worse than its mockup, does not do what the step says, or is worse than it
 * was. On 5 November 2026 the person agreed that a screen still failing one of
 * these after three rounds comes to them, with the shot beside the mockup.
 * Their rule of 12 October 2026, that design checks are not put to them,
 * still holds for every other kind.
 */
export const PERSON_HELD_BREAKS: readonly string[] = ['reference', 'done-when', 'regression'];

/** The start of a session's own settle's notes (`uiSettleSql`). */
export const SETTLE_NOTE_PREFIX = 'Settled by Dash';

/** The `breaks` of `fixes` that only the person settles, once each, in the order written. */
export function heldBreaks(fixes: unknown): string[] {
  if (!Array.isArray(fixes)) return [];
  const out: string[] = [];
  for (const fix of fixes) {
    if (typeof fix !== 'object' || fix === null) continue;
    const breaks = (fix as { breaks?: unknown }).breaks;
    if (typeof breaks !== 'string') continue;
    const kind = breaks.trim().toLowerCase();
    if (PERSON_HELD_BREAKS.includes(kind) && !out.includes(kind)) out.push(kind);
  }
  return out;
}

/**
 * The surfaces whose latest judged round did not pass and cites the mockup,
 * the done-when or a regression, with the kinds it cites (plan #2966.4). A
 * session's settle is not a judgment and is passed over, so a settle written
 * past one does not clear it; a later critic round that passes does, and so
 * does the person's accept.
 */
export function personHeld(checks: readonly CheckRound[]): Map<string, string[]> {
  const latest = new Map<string, CheckRound>();
  for (const check of checks) {
    if (check.verdict === 'accepted' && (check.notes ?? '').startsWith(SETTLE_NOTE_PREFIX)) continue;
    const seen = latest.get(check.surface);
    if (!seen || check.round > seen.round) latest.set(check.surface, check);
  }
  const out = new Map<string, string[]>();
  for (const [surface, round] of latest) {
    if (PASSING_VERDICTS.includes(round.verdict)) continue;
    const kinds = heldBreaks(round.fixes);
    if (kinds.length > 0) out.set(surface, kinds);
  }
  return out;
}

/** How a list of held kinds reads in a sentence: "the mockup and the done-when". */
export function heldKindsText(kinds: readonly string[]): string {
  const words = kinds.map((k) => (k === 'reference' ? 'the mockup' : k === 'done-when' ? 'the done-when' : 'a regression'));
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The SQL condition, over a lateral `judged` row, that the surface's latest
 * judged round is held for the person: the same rule as `personHeld`.
 */
function heldJoin(owner: string, step: number, commit?: string | null): string[] {
  const kinds = PERSON_HELD_BREAKS.map((k) => `'${k}'`).join(', ');
  const passing = PASSING_VERDICTS.map((v) => `'${v}'`).join(', ');
  return [
    'left join lateral (',
    `  select c.verdict not in (${passing}) and exists (`,
    "    select 1 from jsonb_array_elements(case when jsonb_typeof(c.fixes) = 'array' then c.fixes else '[]'::jsonb end) f",
    `    where jsonb_typeof(f) = 'object' and lower(btrim(f->>'breaks')) in (${kinds})`,
    '  ) as held',
    '  from ui_checks c',
    `  where c.user_id = ${owner} and c.step = ${step} and c.surface = s.surface`,
    ...(commit ? [`    and c.commit_sha = '${commit}'`] : []),
    `    and not (c.verdict = 'accepted' and coalesce(c.notes, '') like '${SETTLE_NOTE_PREFIX}%')`,
    '  order by c.round desc limit 1',
    ') judged on true',
  ];
}

/**
 * The surfaces whose layout is still wrong: their latest round that answered
 * the layout question said no (plan #2966.5). A later round that answers yes
 * clears it; a round that never asked, and a settle, do not. The person's
 * accept writes a round that answers yes.
 */
export function layoutBlocked(checks: readonly CheckRound[]): Set<string> {
  const latest = new Map<string, CheckRound>();
  for (const check of checks) {
    if (check.layout_ok === undefined || check.layout_ok === null) continue;
    const seen = latest.get(check.surface);
    if (!seen || check.round > seen.round) latest.set(check.surface, check);
  }
  return new Set([...latest.values()].filter((c) => c.layout_ok === false).map((c) => c.surface));
}

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
 * history whose subject ends `(plan #<n>)` or `(plan #<outline>)`. The commit a close records is
 * usually the merge that put the step on main, and a merge lists no files of
 * its own, so a merge is read against its first parent, which is everything
 * the branch brought in. The subject search catches a step whose close
 * records a later commit than its own.
 *
 * Throws when git cannot read the commit: a guard that cannot see the files
 * must not wave the close through.
 */
export function filesOfStep(
  step: number,
  commit: string,
  git: GitRunner,
  /** The step's outline ("1073.4"), which newer subjects carry instead of the number. */
  outline?: string | null,
): string[] {
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
    ...(outline && outline !== String(step) ? [`--grep=(plan #${outline})`] : []),
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
  const wrongLayout = layoutBlocked(checks);
  const held = personHeld(checks);
  const out: UnpassedSurface[] = [];
  for (const surface of surfaces) {
    const last = latest.get(surface);
    const layoutNo = wrongLayout.has(surface);
    const askPerson = held.get(surface);
    if (last && PASSING_VERDICTS.includes(last.verdict) && !layoutNo && !askPerson) continue;
    out.push({
      surface,
      round: last?.round ?? null,
      verdict: last?.verdict ?? null,
      ...(layoutNo ? { layoutNo: true as const } : {}),
      ...(askPerson ? { askPerson } : {}),
    });
  }
  return out;
}

/**
 * What the builder does with surfaces held for the person, in one sentence,
 * or '' when none is: the decision with the shot beside the mockup, then the
 * block (screen.md, "A screen that misses its mockup goes to the person").
 */
export function personHeldSentence(missing: readonly UnpassedSurface[], step: number | string): string {
  const held = missing.filter((m) => m.askPerson);
  if (held.length === 0) return '';
  return (
    `${held.map((m) => m.surface).join(', ')} still ${held.length === 1 ? 'cites' : 'cite'} ` +
    `${heldKindsText([...new Set(held.flatMap((m) => m.askPerson ?? []))])}, which no settle lets through. ` +
    `Fix ${held.length === 1 ? 'it' : 'them'} and run another round; after round 3, ` +
    `npm run ui-guard -- ${step} --ask writes the question with the shot beside the mockup ` +
    `for plan.ts add --kind decision --mockup, and the step blocks on it. `
  );
}

function describe(missing: UnpassedSurface): string {
  if (missing.round === null) return `${missing.surface} (no round recorded)`;
  if (missing.askPerson) {
    return `${missing.surface} (round ${missing.round} cites ${heldKindsText(missing.askPerson)}: it goes to the person)`;
  }
  if (missing.layoutNo) {
    return `${missing.surface} (its layout does not match the reference: a round has to answer yes)`;
  }
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
  /** The step's outline ("1073.4"), which the sentence names it by when given. */
  outline?: string | null;
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
    `#${input.outline || input.step} changed a screen, and the design critic has not passed ` +
    `${missing.length === 1 ? 'its surface' : `${missing.length} of its surfaces`}: ${which}. ` +
    `Run the critic on ${missing.length === 1 ? 'it' : 'each'} and record the round ` +
    `(npm run ui-check -- ${input.step} ${first.surface} ${next}), then close it once it passes. ` +
    `Surfaces reached only through a shared file are compared with main by ` +
    `npm run ui-guard -- ${input.step} --compare, which settles those that look the same. ` +
    `A surface still failing after round 3 is yours to settle: ` +
    `npm run ui-guard -- ${input.step} --settle "<why>". ` +
    personHeldSentence(missing, input.step) +
    (missing.some((m) => m.layoutNo)
      ? `A layout that differs from its reference is not settled; it waits for a round that answers yes ` +
        `to the layout question, or for the person's answer. `
      : '') +
    `screen.md, beside building.md in the plan skill, has the loop.`
  );
}

/**
 * The statement a session closing through the Supabase connector runs to
 * apply the same rule. It returns one row per surface that has not passed,
 * with the latest round and verdict, so no rows means the step may close.
 * The verdict list comes from `PASSING_VERDICTS`, so the two cannot drift.
 */
/**
 * The numbers of a step and every step beneath it, as a SQL subquery over
 * plan_items for the given owner expression. Rounds under any of them count
 * for the step (see the file header).
 */
export function stepAndBelowSql(step: number, owner: string): string {
  if (!Number.isInteger(step) || step < 1) throw new Error(`"${step}" is not a step number.`);
  return (
    '(with recursive below as (' +
    `select id, number from plan_items where user_id = ${owner} and number = ${step} ` +
    'union all select p.id, p.number from plan_items p join below b on p.parent_id = b.id' +
    ') select number from below)'
  );
}

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
    `  where c.user_id = ${owner} and c.step in ${stepAndBelowSql(step, owner)}`,
    '    and c.surface = s.surface',
    '  order by c.round desc, c.created_at desc limit 1',
    ') last on true',
    'left join lateral (',
    '  select (c.layout->>\'ok\')::boolean as ok from ui_checks c',
    `  where c.user_id = ${owner} and c.step = ${step} and c.surface = s.surface and c.layout is not null`,
    '  order by c.round desc limit 1',
    ') lay on true',
    ...heldJoin(owner, step),
    `where last.verdict is null or last.verdict not in (${passing}) or lay.ok is false or judged.held;`,
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
 * It writes nothing unless the person has answered: the step's comment has
 * an `Answered` line newer than its last `Blocked` line, or (plan #2966.4) a
 * decision with mockup pictures that the step waits on or that sits under it
 * was answered after the latest round on these surfaces. That second is the
 * question a screen held for the person is put as, with its shot beside the
 * mockup, so a session cannot accept its own screens either way. Reading the
 * answer as an accept, rather than as what to change, is the session's call,
 * made by the rule in screen.md.
 */
export function uiAcceptSql(
  step: number,
  surfaces: readonly string[],
  options: {
    /**
     * Where the rounds are kept, when not under `step`: a feature's land
     * review keeps its rounds under the feature (plan #2966.3).
     */
    rounds?: number;
    /** The commit the accept is of, kept as commit_sha, which a land review counts by. */
    commit?: string | null;
  } = {},
): string {
  const at = options.rounds ?? step;
  const commit = options.commit?.trim() || null;
  if (commit && !/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error(`"${commit}" is not a commit sha.`);
  if (!Number.isInteger(at) || at < 1) throw new Error(`"${at}" is not a step number.`);
  const check = uiGuardSql(step, surfaces);
  if (!check) return '';
  const list = surfaces.map((s) => `'${s}'`).join(', ');
  const passing = PASSING_VERDICTS.map((v) => `'${v}'`).join(', ');
  return [
    'with item as (',
    `  select p.id, p.user_id, p.comment from plan_items p where p.number = ${step} limit 1`,
    '), own as (',
    "  select substring(item.comment from '.*(Answered [0-9-]+: [^\\n]*)') as answer from item",
    // The newest Answered line comes after the newest Blocked line.
    "  where strpos(reverse(item.comment), reverse('Answered ')) > 0",
    "    and (strpos(reverse(item.comment), reverse('Blocked ')) = 0",
    "      or strpos(reverse(item.comment), reverse('Answered ')) < strpos(reverse(item.comment), reverse('Blocked ')))",
    '), decided as (',
    // A screen held for the person is asked as a decision with its pictures (plan #2966.4).
    "  select 'Answered on #' || d.number || ': ' || d.resolution as answer",
    '  from item join plan_items d on d.user_id = item.user_id',
    "  where d.kind = 'decision' and d.status = 'done' and coalesce(btrim(d.resolution), '') <> ''",
    '    and (d.parent_id = item.id or exists (',
    '      select 1 from plan_dependencies dep',
    '      where dep.user_id = item.user_id and dep.item_id = item.id and dep.depends_on_id = d.id))',
    '    and exists (select 1 from plan_item_mockups m where m.user_id = item.user_id and m.item_id = d.id)',
    '    and d.completed_at > coalesce((',
    '      select max(c.created_at) from ui_checks c',
    `      where c.user_id = item.user_id and c.step = ${at} and c.surface = any(array[${list}]::text[])`,
    "    ), '-infinity'::timestamptz)",
    '  order by d.completed_at desc limit 1',
    '), step as (',
    '  select item.user_id, coalesce((select answer from own), (select answer from decided)) as answer from item',
    '), waiting as (',
    '  select s.surface, coalesce(last.round, 0) + 1 as round, lay.ok is not null as has_layout',
    `  from unnest(array[${list}]::text[]) as s(surface)`,
    '  cross join step',
    '  left join lateral (',
    '    select c.round, c.verdict from ui_checks c',
    `    where c.user_id = step.user_id and c.step = ${at} and c.surface = s.surface`,
    '    order by c.round desc limit 1',
    '  ) last on true',
    '  left join lateral (',
    "    select (c.layout->>'ok')::boolean as ok from ui_checks c",
    `    where c.user_id = step.user_id and c.step = ${at} and c.surface = s.surface and c.layout is not null`,
    '    order by c.round desc limit 1',
    '  ) lay on true',
    ...heldJoin('step.user_id', at),
    `  where step.answer is not null and (last.verdict is null or last.verdict not in (${passing}) or lay.ok is false or judged.held)`,
    ')',
    'insert into ui_checks (user_id, step, surface, round, verdict, fixes, earlier, notes, shots, layout, commit_sha)',
    `select step.user_id, ${at}, waiting.surface, waiting.round, 'accepted', '[]'::jsonb, '[]'::jsonb,`,
    "  'Accepted by you: ' || step.answer, '{}'::text[],",
    // The person's answer is the one thing that clears a layout that differs.
    "  case when waiting.has_layout then '{\"ok\": true, \"answer\": \"Accepted by you.\"}'::jsonb end,",
    `  ${commit ? `'${commit}'` : 'null'}`,
    'from waiting cross join step',
    'returning surface, round;',
  ].join('\n');
}

/**
 * A session's own settle of the surfaces still waiting, written where the
 * close guard reads it (`npm run ui-guard -- <n> --settle "<why>"`).
 *
 * Design checks are not questions for the person (their answer of 12 October
 * 2026, which replaces decision #1535's A). Two kinds of surface reached them
 * and nothing else: one the critic would not pass after its third round, and
 * one the step's files reach through a shared component that nobody sent to
 * the critic. The builder now settles both itself, says why in `reason`, and
 * closes the step; the open fixes go in its close note, where the person can
 * overrule them.
 *
 * It writes an `accepted` round, numbered on from each surface's last, with
 * notes opening "Settled by Dash", so the record still says who let the
 * screen through.
 *
 * It never settles a surface whose latest judged round cites the mockup, the
 * done-when or a regression (`PERSON_HELD_BREAKS`, plan #2966.4): those go to
 * the person, and the statement passes over them whatever it is given.
 */
export function uiSettleSql(
  step: number,
  surfaces: readonly string[],
  reason: string,
  /**
   * The commit the settle looked at, kept as the round's commit_sha. A
   * feature's land review counts only rounds taken at its branch head
   * (plan #2966.3, lib/plan/ui-feature-review.ts), so its settles carry one.
   */
  commit?: string | null,
): string {
  const check = uiGuardSql(step, surfaces);
  if (!check) return '';
  const why = reason.trim();
  if (!why) throw new Error('Say why the surfaces are settled.');
  if (why.includes('$r$')) throw new Error('The reason cannot contain $r$.');
  if (commit && !/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error(`"${commit}" is not a commit sha.`);
  const sha = commit ? `'${commit}'` : 'null';
  const list = surfaces.map((s) => `'${s}'`).join(', ');
  const passing = PASSING_VERDICTS.map((v) => `'${v}'`).join(', ');
  return [
    'with step as (',
    `  select p.user_id from plan_items p where p.number = ${step} limit 1`,
    '), waiting as (',
    '  select s.surface, coalesce(top.round, 0) + 1 as round',
    `  from unnest(array[${list}]::text[]) as s(surface)`,
    '  cross join step',
    '  left join lateral (',
    '    select max(c.round) as round from ui_checks c',
    `    where c.user_id = step.user_id and c.step = ${step} and c.surface = s.surface`,
    '  ) top on true',
    // With a commit, only a pass at that commit counts as passed: a land
    // review settles what is waiting at the branch head (plan #2966.3).
    '  left join lateral (',
    '    select c.round, c.verdict from ui_checks c',
    `    where c.user_id = step.user_id and c.step = ${step} and c.surface = s.surface`,
    ...(commit ? [`      and c.commit_sha = ${sha}`] : []),
    '    order by c.round desc limit 1',
    '  ) last on true',
    ...heldJoin('step.user_id', step, commit),
    `  where (last.verdict is null or last.verdict not in (${passing})) and not coalesce(judged.held, false)`,
    ')',
    'insert into ui_checks (user_id, step, surface, round, verdict, fixes, earlier, notes, shots, commit_sha)',
    `select step.user_id, ${step}, waiting.surface, waiting.round, 'accepted', '[]'::jsonb, '[]'::jsonb,`,
    `  $r$Settled by Dash: ${why}$r$, '{}'::text[], ${sha}`,
    'from waiting cross join step',
    'returning surface, round;',
  ].join('\n');
}
