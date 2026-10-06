/**
 * Recording a design critic round (plan #1533, docs/UI-QUALITY-SPEC.md Part 2).
 *
 * The builder saves the critic's json verdict unchanged as
 * `.preview-shots/checks/<owner>--<surface>--r<round>.json`, where the owner
 * is the plan step's number or, for a note the notes routine fixed, the
 * note's id. `scripts/ui-check.ts` reads that file, keeps a copy of the four
 * shots the round judged beside it, uploads them to the private `ui-shots`
 * bucket and writes one `public.ui_checks` row. This file is the part with no
 * side effects: reading the arguments and the verdict, naming the files and
 * writing the SQL for a session that has only the Supabase connector.
 */

/** The private bucket the shots go to (supabase/migrations/0173_ui_checks.sql). */
export const UI_SHOTS_BUCKET = 'ui-shots';

/** The four shots `npm run shoot -- <id>` takes of one surface. */
export const SHOT_NAMES = ['phone-light', 'phone-dark', 'laptop-light', 'laptop-dark'] as const;
export type ShotName = (typeof SHOT_NAMES)[number];

/**
 * A shot as it is kept and uploaded: the round's own, or the same view of the
 * surface on main before the step changed it (plan #1541), which the plan row
 * and the changelog show beside the after.
 */
export type KeptShot = ShotName | `before-${ShotName}`;

/**
 * Where the builder leaves main's shots of a surface for the recorder to pick
 * up: the worktree's `.preview-shots/<id>--<shot>.png`, copied here. A new
 * surface has none, and the round is recorded without them.
 */
export const BEFORE_SHOTS_DIR = '.preview-shots/before';

/** Who a round belongs to: a plan step by number, or a note by id. */
export type CheckOwner = { step: number; noteId: null } | { step: null; noteId: string };

export type CriticFix = {
  shot: string;
  where: string;
  problem: string;
  breaks: string;
  change: string;
};

export type CriticVerdict = {
  surface: string;
  round: number;
  verdict: 'pass' | 'fix';
  fixes: CriticFix[];
  earlier: Array<{ where: string; done: boolean | string }>;
  notes: string | null;
};

/** The row a round writes, with the user and the shot paths filled in later. */
export type UiCheckRow = {
  step: number | null;
  note_id: string | null;
  surface: string;
  round: number;
  verdict: 'pass' | 'fix';
  fixes: CriticFix[];
  earlier: Array<{ where: string; done: boolean | string }>;
  notes: string | null;
  shots: string[];
  commit_sha: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SURFACE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** `1533` or `#1533` is a step; a uuid is a note. Anything else is refused. */
export function parseOwner(value: string): CheckOwner {
  const text = value.trim().replace(/^#/, '');
  if (/^\d+$/.test(text) && Number(text) > 0) return { step: Number(text), noteId: null };
  if (UUID.test(text)) return { step: null, noteId: text.toLowerCase() };
  throw new Error(`"${value}" is neither a plan step number nor a note id.`);
}

/** The key the files are named by: the step number or the note id. */
export function ownerKey(owner: CheckOwner): string {
  return owner.step !== null ? String(owner.step) : owner.noteId;
}

export function parseSurface(value: string): string {
  if (!SURFACE.test(value)) throw new Error(`"${value}" is not a gallery surface id.`);
  return value;
}

export function parseRound(value: string): number {
  const round = Number(value);
  if (!Number.isInteger(round) || round < 1) throw new Error(`"${value}" is not a round number.`);
  return round;
}

/** `.preview-shots/checks/<owner>--<surface>--r<round>.json`, as building.md names it. */
export function verdictFile(owner: CheckOwner, surface: string, round: number): string {
  return `.preview-shots/checks/${ownerKey(owner)}--${surface}--r${round}.json`;
}

/** Where `npm run shoot` leaves a shot, overwritten by the next shoot. */
export function shotFile(surface: string, shot: ShotName): string {
  return `.preview-shots/${surface}--${shot}.png`;
}

/** Main's shot of the surface, as the builder copied it from the worktree. */
export function beforeShotFile(surface: string, shot: ShotName): string {
  return `${BEFORE_SHOTS_DIR}/${surface}--${shot}.png`;
}

/** The copy kept beside the verdict, so the next round cannot overwrite it. */
export function keptShotFile(owner: CheckOwner, surface: string, round: number, shot: KeptShot): string {
  return `.preview-shots/checks/${ownerKey(owner)}--${surface}--r${round}--${shot}.png`;
}

/** Its path in the bucket: the account's folder first, which the read policy checks. */
export function bucketPath(
  userId: string,
  owner: CheckOwner,
  surface: string,
  round: number,
  shot: KeptShot,
): string {
  return `${userId}/${ownerKey(owner)}/${surface}/r${round}/${shot}.png`;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`The verdict's ${field} is not text.`);
  return value;
}

/**
 * The critic's json block, checked for the shape `.claude/agents/ui-critic.md`
 * gives it and for the surface and round it was saved under. Nothing is
 * rewritten: a verdict that does not fit is refused, never repaired.
 */
export function parseVerdict(raw: string, surface: string, round: number): CriticVerdict {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('The verdict file is not json. Save the critic block exactly as it came back.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The verdict is not a json object.');
  }
  const v = data as Record<string, unknown>;

  if (v.surface !== surface) {
    throw new Error(`The verdict is for surface "${String(v.surface)}", not "${surface}".`);
  }
  if (v.round !== round) throw new Error(`The verdict is for round ${String(v.round)}, not ${round}.`);
  if (v.verdict !== 'pass' && v.verdict !== 'fix') {
    throw new Error(`The verdict says "${String(v.verdict)}"; it has to be pass or fix.`);
  }

  const fixesIn = v.fixes ?? [];
  if (!Array.isArray(fixesIn)) throw new Error('The verdict fixes are not a list.');
  const fixes = fixesIn.map((fix, i) => {
    if (!fix || typeof fix !== 'object') throw new Error(`Fix ${i + 1} is not an object.`);
    const f = fix as Record<string, unknown>;
    return {
      shot: text(f.shot, `fix ${i + 1} shot`),
      where: text(f.where, `fix ${i + 1} where`),
      problem: text(f.problem, `fix ${i + 1} problem`),
      breaks: text(f.breaks, `fix ${i + 1} breaks`),
      change: text(f.change, `fix ${i + 1} change`),
    };
  });

  const earlierIn = v.earlier ?? [];
  if (!Array.isArray(earlierIn)) throw new Error('The verdict earlier list is not a list.');
  const earlier = earlierIn.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`Earlier item ${i + 1} is not an object.`);
    const e = item as Record<string, unknown>;
    // The critic's instructions write `done` as true or false; older verdicts
    // wrote it as a word. Both are kept as given.
    const done = typeof e.done === 'boolean' ? e.done : text(e.done, `earlier ${i + 1} done`);
    return { where: text(e.where, `earlier ${i + 1} where`), done };
  });

  const notes = v.notes === undefined || v.notes === null ? null : text(v.notes, 'notes');
  return { surface, round, verdict: v.verdict, fixes, earlier, notes };
}

export function checkRow(
  owner: CheckOwner,
  verdict: CriticVerdict,
  shots: string[],
  commitSha: string | null,
): UiCheckRow {
  return {
    step: owner.step,
    note_id: owner.noteId,
    surface: verdict.surface,
    round: verdict.round,
    verdict: verdict.verdict,
    fixes: verdict.fixes,
    earlier: verdict.earlier,
    notes: verdict.notes,
    shots,
    commit_sha: commitSha,
  };
}

/** The line building.md used to ask for in the commit body, still printed as a summary. */
export function checkLine(verdict: CriticVerdict): string {
  const k = verdict.fixes.length;
  return `UI-check: ${verdict.surface} round ${verdict.round} ${verdict.verdict} (${k} fix${k === 1 ? '' : 'es'})`;
}

/** Text the connector is never shown raw: base64 has no quote of any kind in it. */
function encoded(value: string): string {
  return `convert_from(decode('${Buffer.from(value, 'utf8').toString('base64')}', 'base64'), 'utf8')`;
}

/**
 * The statement for a session with only the Supabase connector. The account is
 * the one that owns the step or the note, so no user id is needed. The critic's
 * words go in base64, because the connector has held statements with an
 * apostrophe in their quoted text, and the critic writes plenty of those.
 * Recording a round again replaces it, keeping shot paths already uploaded.
 */
export function connectorSql(row: UiCheckRow): string {
  const owner =
    row.step !== null
      ? `(select user_id from plan_items where number = ${row.step} limit 1)`
      : `(select user_id from feedback_items where id = '${row.note_id}')`;
  const conflict = row.step !== null ? '(user_id, step, surface, round)' : '(user_id, note_id, surface, round)';
  const shots = row.shots.length
    ? `array[${row.shots.map((s) => `'${s.replace(/'/g, '')}'`).join(', ')}]::text[]`
    : `'{}'::text[]`;
  return [
    'insert into ui_checks (user_id, step, note_id, surface, round, verdict, fixes, earlier, notes, shots, commit_sha)',
    `select ${owner}, ${row.step ?? 'null'}, ${row.note_id ? `'${row.note_id}'::uuid` : 'null'},`,
    `  '${row.surface}', ${row.round}, '${row.verdict}',`,
    `  ${encoded(JSON.stringify(row.fixes))}::jsonb,`,
    `  ${encoded(JSON.stringify(row.earlier))}::jsonb,`,
    `  ${row.notes === null ? 'null' : encoded(row.notes)},`,
    `  ${shots}, ${row.commit_sha ? `'${row.commit_sha.replace(/[^0-9a-f]/gi, '')}'` : 'null'}`,
    `on conflict ${conflict} do update set verdict = excluded.verdict, fixes = excluded.fixes,`,
    '  earlier = excluded.earlier, notes = excluded.notes, commit_sha = excluded.commit_sha,',
    '  shots = case when cardinality(excluded.shots) > 0 then excluded.shots else ui_checks.shots end',
    'returning id, surface, round, verdict, jsonb_array_length(fixes) as fixes;',
  ].join('\n');
}
