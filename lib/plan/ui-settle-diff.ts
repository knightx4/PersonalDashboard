/**
 * The settle's picture check (plan #2215.4).
 *
 * `npm run ui-guard -- <n> --settle "<why>"` lets the builder through on two
 * kinds of surface: one the critic would not pass after its third round, and
 * one a step reached only through a shared file. The second kind was settled
 * on the builder's word that the screen had not changed, and 4,556 of 6,655
 * screen checks went through that way without the critic seeing them. The
 * runner panel's strip and the essay editor's gap were among them.
 *
 * So a surface the critic has not judged through three rounds is settled only
 * when its shots match main's: the branch's `.preview-shots/<id>--<shot>.png`
 * against `.preview-shots/before/<id>--<shot>.png`, pixel by pixel, for each
 * of the four shots. A surface with a shot missing on either side, a shot
 * whose size changed, or more than `CHANGED_SHARE` of its pixels different is
 * refused, and the refusal names it as needing a critic round.
 *
 * The rule is here with the image reader passed in, so the comparison is
 * tested on real PNGs without the script around it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeShotFile, shotFile, SHOT_NAMES } from '../preview/ui-checks';
import { ROUNDS_PER_TURN } from './ui-check-stop';
import { unpassedSurfaces, type CheckRound } from './ui-check-guard';

/**
 * How far one channel of a pixel may move before the pixel counts as
 * different. Two renders of the same page can differ by a few levels where
 * text is anti-aliased; a changed colour, border or gap moves far more.
 */
export const CHANNEL_TOLERANCE = 24;

/**
 * The share of a shot's pixels that may differ before the surface counts as
 * changed: one in ten thousand, about 40 pixels on a 390 by 1000 phone shot.
 * A changed word, a moved line or a new gap is well over it.
 */
export const CHANGED_SHARE = 0.0001;

/** A decoded shot: RGBA, four bytes a pixel, row by row. */
export type RawShot = { width: number; height: number; data: Uint8Array };

/**
 * How many pixels of `after` differ from `before`, or null when the two are
 * not the same size (a gap that grew changes the page's height, and that is
 * a change however the pixels line up).
 */
export function differingPixels(before: RawShot, after: RawShot): number | null {
  if (before.width !== after.width || before.height !== after.height) return null;
  const a = before.data;
  const b = after.data;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i]! - b[i]!) > CHANNEL_TOLERANCE ||
      Math.abs(a[i + 1]! - b[i + 1]!) > CHANNEL_TOLERANCE ||
      Math.abs(a[i + 2]! - b[i + 2]!) > CHANNEL_TOLERANCE ||
      Math.abs(a[i + 3]! - b[i + 3]!) > CHANNEL_TOLERANCE
    ) {
      count += 1;
    }
  }
  return count;
}

/** What the comparison found for one surface. */
export type ShotComparison = {
  surface: string;
  /** `same` may be settled; `changed` and `unshot` need a critic round. */
  outcome: 'same' | 'changed' | 'unshot';
  /** For `changed` and `unshot`, which shots and why, in a few words each. */
  reasons: string[];
};

/** Reads a PNG into RGBA, or null when there is no file at the path. */
export type ShotReader = (path: string) => Promise<RawShot | null>;

/** The reader the script uses: sharp, from the checkout `root`. */
export function fileShotReader(root: string): ShotReader {
  return async (path) => {
    const full = join(root, path);
    if (!existsSync(full)) return null;
    const { data, info } = await sharp(full)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  };
}

/** Compares the four shots of `surface` with main's. */
export async function compareSurfaceShots(
  surface: string,
  read: ShotReader,
): Promise<ShotComparison> {
  const reasons: string[] = [];
  let unshot = false;
  for (const shot of SHOT_NAMES) {
    const [before, after] = await Promise.all([
      read(beforeShotFile(surface, shot)),
      read(shotFile(surface, shot)),
    ]);
    if (!before || !after) {
      unshot = true;
      const missing =
        !before && !after ? "of main's or this branch" : !before ? "of main's" : 'of this branch';
      reasons.push(`${shot} has no shot ${missing}`);
      continue;
    }
    const differing = differingPixels(before, after);
    if (differing === null) {
      reasons.push(
        `${shot} changed size, ${before.width}x${before.height} to ${after.width}x${after.height}`,
      );
    } else if (differing > before.width * before.height * CHANGED_SHARE) {
      const share = (differing / (before.width * before.height)) * 100;
      reasons.push(
        `${shot} differs in ${differing} pixels (${share < 0.1 ? share.toFixed(2) : share.toFixed(1)}%)`,
      );
    }
  }
  if (unshot) return { surface, outcome: 'unshot', reasons };
  return { surface, outcome: reasons.length > 0 ? 'changed' : 'same', reasons };
}

/**
 * The surfaces a settle has to compare: those still waiting (no passing round)
 * that the critic has not judged through its three rounds. A surface whose
 * latest round is the critic's `fix` at round 3 or later has been seen, and
 * settling it is the stop screen.md describes; every other waiting surface
 * reached the step through a shared file and is settled only if unchanged.
 */
export function surfacesToCompare(
  surfaces: readonly string[],
  checks: readonly CheckRound[],
): string[] {
  return unpassedSurfaces(surfaces, checks)
    .filter((s) => !(s.verdict === 'fix' && s.round !== null && s.round >= ROUNDS_PER_TURN))
    .map((s) => s.surface);
}

/**
 * The step's rounds as this checkout recorded them, for a session with no
 * DATABASE_URL: every `.preview-shots/checks/<step>--<surface>--r<round>.json`
 * the recorder read, with the verdict the critic wrote in it. A file that is
 * not the critic's json is skipped, so it counts as no round.
 */
export function localCheckRounds(step: number, root: string): CheckRound[] {
  const dir = join(root, '.preview-shots/checks');
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${step}--([a-z0-9][a-z0-9-]*)--r(\\d+)\\.json$`);
  const rounds: CheckRound[] = [];
  for (const file of readdirSync(dir)) {
    const match = pattern.exec(file);
    if (!match) continue;
    try {
      const verdict = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { verdict?: unknown })
        .verdict;
      if (typeof verdict === 'string')
        rounds.push({ surface: match[1]!, round: Number(match[2]), verdict });
    } catch {
      // Not the critic's json: no round.
    }
  }
  return rounds;
}

/**
 * Why the settle is refused, or null when every compared surface matched
 * main's. The refusal names each surface that needs a critic round.
 */
export function settleRefusal(
  name: string,
  step: number,
  comparisons: readonly ShotComparison[],
): string | null {
  const refused = comparisons.filter((c) => c.outcome !== 'same');
  if (refused.length === 0) return null;
  const lines = refused.map((c) => `  ${c.surface}: ${c.reasons.join('; ')}`);
  const unshot = refused.some((c) => c.outcome === 'unshot');
  return [
    `Settle refused on ${name}: ${refused.length === 1 ? 'one surface is' : `${refused.length} surfaces are`} ` +
      `not shown to look the same as on main, so the critic has to see ${refused.length === 1 ? 'it' : 'them'}.`,
    ...lines,
    `Send ${refused.length === 1 ? 'it' : 'each'} to the critic and record the round ` +
      `(npm run ui-check -- ${step} ${refused[0]!.surface} <round>).`,
    ...(unshot
      ? [
          "A shot that is missing has to be taken: main's in a worktree of origin/main, copied into " +
            ".preview-shots/before/, and this branch's with npm run shoot. screen.md, step 1, has how.",
        ]
      : []),
  ].join('\n');
}
