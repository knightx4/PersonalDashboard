/**
 * The stop after a third failed critic round (plan #1609, decision #1535).
 *
 * When a surface's round 3 still comes back `fix`, the builder runs no fourth
 * round. It records the round, pushes its branch, and blocks the step on the
 * person (`block_kind = 'outside'`) with the ask this file writes: each
 * surface that did not pass, how many fixes are open, where the shots are and
 * the branch, ending "accept it as it is, or say what to change". A note the
 * notes routine fixed is blocked with the same ask.
 *
 * After the person says what to change, the builder gets three fresh rounds,
 * numbered on from 4, so the stop falls on rounds 3, 6, 9 and so on.
 *
 * Plan #1610 reads this back: `isCriticStopAsk` recognises a blocked step that
 * stopped here, and `stoppedSurfaces` names the surfaces from its rounds in
 * `public.ui_checks`. No side effects, so both are tested without a database.
 */

/** Rounds the builder runs before handing the screen to the person. */
export const ROUNDS_PER_TURN = 3;

/** How every stop ask ends; `isCriticStopAsk` looks for it. */
export const STOP_ASK_ENDING = 'accept it as it is, or say what to change.';

/** How every stop ask opens. */
const STOP_ASK_OPENING = 'The design critic did not pass ';

/** True for the round that ends a turn of three: 3, then 6 after a redirect, and so on. */
export function isStopRound(round: number): boolean {
  return Number.isInteger(round) && round >= ROUNDS_PER_TURN && round % ROUNDS_PER_TURN === 0;
}

/** As much of a `ui_checks` row as the stop reads. */
export type StopRound = {
  surface: string;
  round: number;
  verdict: string;
  /** The critic's fixes, or just how many there were. */
  fixes: readonly unknown[] | number;
  /** Paths in the `ui-shots` bucket; empty when the shots were not uploaded. */
  shots: readonly string[];
};

/** A surface the critic would not pass at the end of a turn. */
export type StoppedSurface = {
  surface: string;
  round: number;
  fixes: number;
  /** True when the round's shots are in the `ui-shots` bucket. */
  uploaded: boolean;
};

/**
 * The surfaces whose latest round is a `fix` on a stop round, in the order of
 * their first appearance. A surface whose latest round passed, or that is
 * still inside its three rounds, is not stopped.
 */
export function stoppedSurfaces(rounds: readonly StopRound[]): StoppedSurface[] {
  const latest = new Map<string, StopRound>();
  for (const r of rounds) {
    const seen = latest.get(r.surface);
    if (!seen || r.round > seen.round) latest.set(r.surface, r);
  }
  const out: StoppedSurface[] = [];
  for (const r of latest.values()) {
    if (r.verdict !== 'fix' || !isStopRound(r.round)) continue;
    out.push({
      surface: r.surface,
      round: r.round,
      fixes: typeof r.fixes === 'number' ? r.fixes : r.fixes.length,
      uploaded: r.shots.length > 0,
    });
  }
  return out;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function describe(s: StoppedSurface, owner: string): string {
  const where = s.uploaded
    ? `shots in ui-shots under ${owner}/${s.surface}/r${s.round}`
    : `shots not uploaded, kept in .preview-shots/checks/ by the session that ran it`;
  return `${s.surface} after round ${s.round} (${plural(s.fixes, 'fix', 'fixes')} open, ${where})`;
}

/**
 * The ask a step (or note) is blocked with. `owner` is the step number or the
 * note id; `branch` is the pushed branch that holds the work.
 */
export function criticStopAsk(input: {
  owner: number | string;
  surfaces: readonly StoppedSurface[];
  branch: string;
}): string {
  if (input.surfaces.length === 0) throw new Error('No surface stopped: nothing to ask.');
  if (!input.branch.trim()) throw new Error('Name the branch that holds the work.');
  const owner = String(input.owner).replace(/^#/, '');
  const label = /^\d+$/.test(owner) ? `#${owner}` : `note ${owner}`;
  const which = input.surfaces.map((s) => describe(s, owner)).join('; ');
  return (
    `${STOP_ASK_OPENING}${label}'s screen: ${which}. ` +
    `The work is on branch ${input.branch.trim()}. Look at the shots and the fixes, then ${STOP_ASK_ENDING}`
  );
}

/** True for a block ask `criticStopAsk` wrote. */
export function isCriticStopAsk(ask: string | null | undefined): boolean {
  if (!ask) return false;
  return ask.startsWith(STOP_ASK_OPENING) && ask.trimEnd().endsWith(STOP_ASK_ENDING);
}

/**
 * The connector statement that blocks a plan step with the ask, as offline.md
 * writes a block: waiting on the person, the ask on the row and a dated line
 * appended to its history, recorded for Home's undo. The ask is dollar-quoted,
 * so the apostrophe in it reaches the connector as written.
 */
export function criticStopBlockSql(input: {
  step: number;
  ask: string;
  date: string;
  /** The step's owner; read from the step itself when left out. */
  userId?: string;
}): string {
  if (input.userId !== undefined && !/^[0-9a-f-]{36}$/i.test(input.userId)) {
    throw new Error(`"${input.userId}" is not a user id.`);
  }
  if (!Number.isInteger(input.step) || input.step < 1) throw new Error(`"${input.step}" is not a step number.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error(`"${input.date}" is not a date.`);
  if (input.ask.includes('$a$')) throw new Error('The ask cannot contain $a$.');
  const user = input.userId
    ? `'${input.userId}'`
    : `(select user_id from plan_items where number = ${input.step} limit 1)`;
  const match = `user_id = ${user} and number = ${input.step}`;
  const ref = `'public.plan_items:' || (select id from plan_items where ${match})`;
  return [
    `select core.dash_before(${ref});`,
    'update plan_items',
    `set status = 'blocked', block_ask = $a$${input.ask}$a$, block_kind = 'outside',`,
    `    comment = coalesce(comment || E'\\n\\n', '') || $a$Blocked ${input.date}: ${input.ask}$a$`,
    `where ${match};`,
    `select core.record_dash_action(${user}, ${ref}, 'update', 'block_step',`,
    `  $a$Dash stopped step #${input.step} after the design critic's last round and handed the screen to you.$a$);`,
  ].join('\n');
}

/**
 * The branch a stop ask names, or null when it names none. Accepting the
 * screen hands that branch to the session that merges and closes the step.
 */
export function stopBranch(ask: string | null | undefined): string | null {
  if (!ask) return null;
  const m = /The work is on branch (\S+?)\.?\s+Look at the shots/.exec(ask);
  return m ? m[1] : null;
}

/** One fix as the critic wrote it, with every part a string (plan #1610). */
export type StopFix = {
  shot: string;
  where: string;
  problem: string;
  breaks: string;
  change: string;
};

/** Reads a `ui_checks.fixes` array as the critic wrote it, keeping what is readable. */
export function readStopFixes(raw: unknown): StopFix[] {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return raw
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      shot: text(f.shot),
      where: text(f.where),
      problem: text(f.problem),
      breaks: text(f.breaks),
      change: text(f.change),
    }))
    .filter((f) => f.problem || f.change);
}

/** One shot of a stopped round, with a link the page can open, or none. */
export type StopShot = { name: string; url: string | null };

/** A stopped surface as /dev/plan draws it: the last fixes and the shots. */
export type StopSurfaceView = {
  surface: string;
  round: number;
  fixes: StopFix[];
  shots: StopShot[];
};

/** What /dev/plan shows on a step the critic stopped, by step id. */
export type CriticStopView = { surfaces: StopSurfaceView[]; branch: string | null };

/** The shot's name from its bucket path: `…/r3/phone-light.png` is `phone-light`. */
export function shotName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.png$/i, '');
}

/**
 * The rows accepting writes: one `accepted` round per stopped surface,
 * numbered on from the round that stopped, so it becomes the latest and the
 * close guard reads it as passed.
 */
export function acceptedRounds(
  stopped: readonly Pick<StoppedSurface, 'surface' | 'round'>[],
): { surface: string; round: number; verdict: 'accepted' }[] {
  return stopped.map((s) => ({ surface: s.surface, round: s.round + 1, verdict: 'accepted' }));
}

/** The dated line accepting adds to the step's history, saying what the next session does. */
export function acceptedLine(input: {
  date: string;
  surfaces: readonly string[];
  branch: string | null;
}): string {
  const which = input.surfaces.join(', ');
  const next = input.branch
    ? `The work is on branch ${input.branch}: merge it and close the step.`
    : 'Merge the branch that holds the work and close the step.';
  return `Accepted ${input.date}: the screen as it is, past the design critic's last round (${which}). ${next}`;
}

/**
 * The Needs line /dev/plan draws on a stopped step in place of the whole ask,
 * since the panel beneath it lists the surfaces, fixes and shots.
 */
export function criticStopNeeds(branch: string | null): string {
  const where = branch ? ` The work is on branch ${branch}.` : '';
  return `Your call on a screen the design critic would not pass.${where}`;
}
