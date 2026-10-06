/**
 * A step's changed screens as before and after pictures (plan #1541,
 * docs/UI-QUALITY-SPEC.md Part 6).
 *
 * Every design critic round is a row in `public.ui_checks`, with the shots it
 * judged in the private `ui-shots` bucket. The after shots are the round's
 * own four (`phone-light` and so on). The before shots are the same surface
 * photographed on main before the step changed it, uploaded beside them as
 * `before-phone-light` and so on by `npm run ui-check` (scripts/ui-check.ts).
 * A new surface has no before.
 *
 * What a step shows is each surface's last passing round: the critic's `pass`
 * or the person's `accepted`. An accepted round is written from /dev/plan and
 * carries no shots of its own, so its pictures are those of the latest round
 * before it that has some, which is the round the person looked at. The
 * before shots are the same on every round of a surface, so any round's do.
 *
 * Only the phone pictures are shown, light first: the person reads the plan
 * and the changelog on a phone, and the laptop shots stay for the critic.
 *
 * No side effects: rows in, a view out, with the links made by the caller.
 */
import { PASSING_VERDICTS } from './ui-check-guard';

/** The prefix that marks a before shot in the bucket (`before-phone-light.png`). */
export const BEFORE_PREFIX = 'before-';

/** The phone shots, in the order a picture is chosen from. */
const PHONE_SHOTS = ['phone-light', 'phone-dark'] as const;

/** As much of a `ui_checks` row as this reads. */
export type ScreenCheckRow = {
  step: number;
  surface: string;
  round: number;
  verdict: string;
  shots: readonly string[] | null;
  created_at: string;
};

/** One changed surface of a step: where its pictures are, as bucket paths. */
export type ScreenChange = {
  surface: string;
  /** The passing round the pictures belong to. */
  round: number;
  verdict: 'pass' | 'accepted';
  /** When that round was recorded; #1542's "changed this week" reads it. */
  checkedAt: string;
  /** The phone shot of the surface on main before the step, or null for a new surface. */
  before: string | null;
  /** The phone shot the critic passed, or null when it was not uploaded. */
  after: string | null;
};

/** The same, with `before` and `after` as links the page can load rather than bucket paths. */
export type ScreenChangeView = ScreenChange;

/** The shot's name from its bucket path: `…/r2/before-phone-light.png` is `before-phone-light`. */
export function shotNameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.png$/i, '');
}

/** True for a before shot's path. */
export function isBeforeShot(path: string): boolean {
  return shotNameOf(path).startsWith(BEFORE_PREFIX);
}

/** The phone picture among a round's shots, light first, or null. */
function phoneShot(shots: readonly string[], before: boolean): string | null {
  for (const name of PHONE_SHOTS) {
    const want = before ? `${BEFORE_PREFIX}${name}` : name;
    const found = shots.find((path) => shotNameOf(path) === want);
    if (found) return found;
  }
  return null;
}

/**
 * Each step's changed surfaces, by step number, in the order each surface
 * first appears in the rows. A surface with no passing round is left out:
 * the pictures are of a screen that passed, never of one still being fixed.
 */
export function screenChanges(rows: readonly ScreenCheckRow[]): Record<number, ScreenChange[]> {
  const bySurface = new Map<string, ScreenCheckRow[]>();
  for (const row of rows) {
    const key = `${row.step}\u0000${row.surface}`;
    const list = bySurface.get(key);
    if (list) list.push(row);
    else bySurface.set(key, [row]);
  }

  const out: Record<number, ScreenChange[]> = {};
  for (const list of bySurface.values()) {
    const rounds = [...list].sort((a, b) => b.round - a.round);
    const passed = rounds.find((r) => PASSING_VERDICTS.includes(r.verdict));
    if (!passed) continue;

    const pictured = rounds.find(
      (r) => r.round <= passed.round && phoneShot(r.shots ?? [], false) !== null,
    );
    const withBefore = rounds.find((r) => phoneShot(r.shots ?? [], true) !== null);

    const change: ScreenChange = {
      surface: passed.surface,
      round: passed.round,
      verdict: passed.verdict === 'accepted' ? 'accepted' : 'pass',
      checkedAt: passed.created_at,
      before: withBefore ? phoneShot(withBefore.shots ?? [], true) : null,
      after: pictured ? phoneShot(pictured.shots ?? [], false) : null,
    };
    (out[passed.step] ??= []).push(change);
  }
  return out;
}

/**
 * Where the page loads a shot from: a route that checks the path is the
 * account's own and redirects to a short signed link (app/dev/ui/shot).
 * Signing at the moment the picture loads, rather than for every step when
 * the page renders, means a page of a hundred finished steps signs nothing
 * until one is opened.
 */
export function shotHref(path: string): string {
  return `/dev/ui/shot?path=${encodeURIComponent(path)}`;
}

/** The view a page draws, with each path turned into a link. */
export function screenChangeViews(
  changes: Readonly<Record<number, readonly ScreenChange[]>>,
  href: (path: string) => string = shotHref,
): Record<number, ScreenChangeView[]> {
  const out: Record<number, ScreenChangeView[]> = {};
  for (const [step, list] of Object.entries(changes)) {
    out[Number(step)] = list.map((c) => ({
      ...c,
      before: c.before ? href(c.before) : null,
      after: c.after ? href(c.after) : null,
    }));
  }
  return out;
}

/** True when a path is in this account's folder of the bucket, which is all the route serves. */
export function ownsShotPath(userId: string, path: string): boolean {
  if (!path.startsWith(`${userId}/`)) return false;
  if (path.includes('..') || path.includes('\\')) return false;
  return /^[0-9a-f-]+\/[\w-]+\/[a-z0-9-]+\/r\d+\/[\w-]+\.png$/i.test(path);
}
