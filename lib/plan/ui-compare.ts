/**
 * The design check's own comparison with main (plan #2815.3).
 *
 * A step that changes a shared file reaches every surface that file is drawn
 * on: 150 for Chat's built steps on 4 November 2026, when the step that
 * changed the comment body reached 106 on its own. The builder used to shoot
 * each of them on main and on the branch and run `--settle`, and no session
 * got through that many before it ran out. So `npm run ui-guard -- <n>
 * --compare` does it: the surfaces the step meant to change go to the critic
 * as before, and the rest are shot on both checkouts and compared with the
 * settle's own rule (`lib/plan/ui-settle-diff.ts`). Those that look the same
 * are settled; only those that changed are listed for the critic.
 *
 * Plan #2966.2: the surfaces a step meant to change are compared too. A
 * screen the step lists as its own may have no visible change (a hidden part
 * drawn the same, a state the edit did not reach), and the critic used to be
 * sent it anyway. Now every surface that has not passed is shot on both
 * checkouts, and only those whose shots differ from main's, or that main does
 * not have, go to the critic.
 *
 * `splitSurfaces` still says which surfaces a step meant to change: those the
 * critic has judged on it (any round but an `accepted` one, which is a settle
 * rather than a look), and those its title, detail or done-when links as
 * `/preview?s=<id>`. A page address in its words does not count: #2748.13's
 * mention of /dev/ui named 29 surfaces. The compare run uses it for the line
 * it prints, not to hold a surface back. A surface whose latest round already
 * passes is in neither list.
 *
 * Nothing here has side effects; the servers and the shooting are in
 * `scripts/ui-guard-compare.ts`.
 */
import { unpassedSurfaces, type CheckRound } from './ui-check-guard';
import type { ShotComparison } from './ui-settle-diff';

/** The surfaces a step's files serve that have not passed, split by whether the step set out to change them. */
export type SurfaceSplit = {
  /** Judged by the critic or linked by the step: the critic sees these. */
  named: string[];
  /** Reached only through a shared file: compared with main. */
  reached: string[];
};

/** The surface ids a piece of writing links as `/preview?s=<id>`. */
export function linkedSurfaces(text: string): Set<string> {
  return new Set([...text.matchAll(/\/preview\?s=([\w-]+)/g)].map((m) => m[1]!));
}

export function splitSurfaces(
  surfaces: readonly string[],
  stepText: string,
  checks: readonly CheckRound[],
): SurfaceSplit {
  const meant = linkedSurfaces(stepText);
  for (const check of checks) if (check.verdict !== 'accepted') meant.add(check.surface);
  const waiting = unpassedSurfaces(surfaces, checks).map((s) => s.surface);
  return {
    named: waiting.filter((s) => meant.has(s)),
    reached: waiting.filter((s) => !meant.has(s)),
  };
}

/**
 * The surfaces split across `workers` shooters, round robin, so neighbours in
 * gallery order (often one page's states, all equally slow) spread out. An
 * empty share is dropped.
 */
export function shares<T>(items: readonly T[], workers: number): T[][] {
  const n = Math.max(1, Math.floor(workers));
  const out: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => out[i % n]!.push(item));
  return out.filter((share) => share.length > 0);
}

/**
 * The port each shooter's Chromium answers on. Builders on one machine run
 * side by side on ports 3400 up, and two shooters on one probe port drive the
 * same browser, so the block follows the preview port: 9600 + 10 a builder.
 * Main's shooters take the second five of the block.
 */
export function probePort(previewPort: number, side: 'branch' | 'main', worker: number): number {
  return 9600 + (previewPort % 100) * 10 + (side === 'main' ? 5 : 0) + worker;
}

/** The port main's preview is served on beside a builder's own. */
export function mainPreviewPort(previewPort: number): number {
  return previewPort + 1000;
}

/** Why a surface that looks the same as main is settled, as its round's notes say. */
export const SAME_AS_MAIN_REASON =
  'ui-guard --compare found its four shots the same as main\'s, so it has no visible change for the critic to judge';

/** How long each part took, in milliseconds. */
export type CompareTimings = { build: number; shoot: number; compare: number };

function seconds(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 120 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/**
 * What a compare run prints: how many surfaces it settled and how many go to
 * the critic, then the ones that go (those whose shots differ from main's or
 * that main does not have), with the time each part took. Every surface the
 * step's files serve was compared, those the step names included.
 */
export function compareReport(input: {
  name: string;
  step: number;
  comparisons: readonly ShotComparison[];
  /** Surfaces main's gallery does not have: new on this branch. */
  newOnBranch: readonly string[];
  timings: CompareTimings;
}): { forCritic: string[]; settled: string[]; text: string } {
  const { name, step, comparisons, newOnBranch, timings } = input;
  const changed = comparisons.filter((c) => c.outcome !== 'same');
  const settled = comparisons.filter((c) => c.outcome === 'same').map((c) => c.surface);
  const forCritic = changed.map((c) => c.surface);
  const lines = [
    `${name}: compared ${comparisons.length} surface${comparisons.length === 1 ? '' : 's'} with main. ` +
      `Settled ${settled.length} that look the same; ${forCritic.length} go${forCritic.length === 1 ? 'es' : ''} to the critic.`,
    `Time: building ${seconds(timings.build)}, shooting ${seconds(timings.shoot)}, comparing ${seconds(timings.compare)}.`,
  ];
  if (forCritic.length === 0) {
    lines.push('Nothing for the critic: every surface the files reach looks the same as on main.');
  } else {
    lines.push(`For the critic (${forCritic.length}):`);
    for (const c of changed) {
      const why = newOnBranch.includes(c.surface) ? 'new on this branch' : c.reasons.join('; ');
      lines.push(`  ${c.surface}: ${why}`);
    }
    lines.push(
      `Send each to the critic and record the round (npm run ui-check -- ${step} <surface> <round>).`,
    );
  }
  return { forCritic, settled, text: lines.join('\n') };
}
