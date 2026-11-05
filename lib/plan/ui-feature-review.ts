/**
 * The design review a feature gets once, when it lands (plan #2966.3).
 *
 * A feature with four screen steps used to be reviewed four times: each step's
 * builder ran the critic on the surfaces its files reached, at its own commit,
 * and `land` closed each step on its own rounds. A page two steps both touched
 * was judged twice, the first time in a state the second step then changed,
 * and none of the rounds was of the screen that went to main.
 *
 * Now the rounds that count are the feature's own: recorded under the
 * feature's number (`npm run ui-check -- <feature> <surface> <round> --commit
 * <head>`), taken at the branch head once every step is built, for the union of
 * the surfaces the built steps reach. `land` reads that one set and closes
 * every step from it. Builders still shoot and check their own surfaces as they
 * go (screen.md); those rounds are theirs and no longer close anything.
 *
 * A round counts when it was taken at a commit that holds every built step's
 * commit, so a round from before the last step was built does not, and, where
 * a head is given, when no screen file the feature changed has changed between
 * that commit and the head. The layout rule of plan #2966.5 is read over every
 * round of the feature, counted or not: a "no" on the layout stays until a
 * later round answers yes. A counted round that cites the mockup, the
 * done-when or a regression holds its surface for the person (plan #2966.4,
 * `personHeld`): no settle lets it through, only a later pass or their answer.
 *
 * Surfaces that share a page are judged together (`pageGroups`): the page's
 * main state at its four shots and its other states as one strip, in one
 * round, recorded for each surface in the group.
 *
 * No side effects: git is passed in, and the rounds as rows.
 */
import { SURFACE_ROUTES } from '../preview/routes';
import {
  heldKindsText,
  isScreenFile,
  layoutBlocked,
  personHeldSentence,
  unpassedSurfaces,
  type CheckRound,
  type GitRunner,
  type UnpassedSurface,
} from './ui-check-guard';

/** A feature's round, with the commit it was taken at. */
export type FeatureRound = CheckRound & { commit_sha: string | null };

/** A built step under the feature, with what its commits changed. */
export type BuiltScreenStep = {
  number: number;
  outline?: string | null;
  commit: string;
  files: readonly string[];
  surfaces: readonly string[];
};

/** Whether `ancestor` is on the history of `descendant`; false when git cannot say. */
function isAncestor(git: GitRunner, ancestor: string, descendant: string): boolean {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The rounds that count for the review: those taken at a commit holding every
 * commit in `contains` and, with a `head`, on the head's history with none of
 * `screenFiles` changed between them.
 */
export function roundsAtHead(
  rounds: readonly FeatureRound[],
  input: { contains: readonly string[]; head?: string | null; screenFiles?: readonly string[] },
  git: GitRunner,
): FeatureRound[] {
  const verdicts = new Map<string, boolean>();
  const watched = new Set((input.screenFiles ?? []).filter(isScreenFile));
  const counts = (commit: string): boolean => {
    if (!input.contains.every((sha) => isAncestor(git, sha, commit))) return false;
    if (!input.head) return true;
    if (!isAncestor(git, commit, input.head)) return false;
    let changed: string[];
    try {
      changed = git(['diff', '--name-only', commit, input.head]).split('\n').map((l) => l.trim());
    } catch {
      return false;
    }
    return !changed.some((file) => watched.has(file));
  };
  return rounds.filter((round) => {
    const sha = round.commit_sha?.trim();
    if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return false;
    if (!verdicts.has(sha)) verdicts.set(sha, counts(sha));
    return verdicts.get(sha)!;
  });
}

/** Every surface the built steps that changed a screen file reach, once each, sorted. */
export function featureSurfaces(steps: readonly BuiltScreenStep[]): string[] {
  const out = new Set<string>();
  for (const step of steps) {
    if (!step.files.some(isScreenFile)) continue;
    for (const surface of step.surfaces) out.add(surface);
  }
  return [...out].sort();
}

/**
 * The surfaces in `surfaces` the review has not passed: the latest counted
 * round is not a pass, or the latest round of any commit that answered the
 * layout question said no.
 */
export function featureUnpassed(
  surfaces: readonly string[],
  all: readonly FeatureRound[],
  counting: readonly FeatureRound[],
): UnpassedSurface[] {
  const missing = unpassedSurfaces(surfaces, counting);
  const wrongLayout = layoutBlocked(all);
  const named = new Set(missing.map((m) => m.surface));
  for (const surface of surfaces) {
    if (named.has(surface) || !wrongLayout.has(surface)) continue;
    const last = counting
      .filter((r) => r.surface === surface)
      .reduce<FeatureRound | null>((a, r) => (!a || r.round > a.round ? r : a), null);
    missing.push({ surface, round: last?.round ?? null, verdict: last?.verdict ?? null, layoutNo: true });
  }
  const order = new Map(surfaces.map((s, i) => [s, i]));
  return missing.sort((a, b) => (order.get(a.surface) ?? 0) - (order.get(b.surface) ?? 0));
}

function describe(missing: UnpassedSurface): string {
  if (missing.askPerson) {
    return `${missing.surface} (round ${missing.round} cites ${heldKindsText(missing.askPerson)}: it goes to the person)`;
  }
  if (missing.layoutNo) return `${missing.surface} (its layout does not match the reference)`;
  if (missing.round === null) return `${missing.surface} (no round at the branch head)`;
  return `${missing.surface} (round ${missing.round} asked for fixes)`;
}

/**
 * What `land` does with each built step's screens: the steps it may close, and
 * for the rest the sentence saying which of the feature's surfaces hold them.
 * A step that changed no screen file closes on its commit alone.
 */
export function featureLandCheck(input: {
  feature: number;
  outline?: string | null;
  steps: readonly BuiltScreenStep[];
  all: readonly FeatureRound[];
  counting: readonly FeatureRound[];
}): { closes: number[]; held: Map<number, string> } {
  const name = `#${input.outline || input.feature}`;
  const surfaces = featureSurfaces(input.steps);
  const missing = featureUnpassed(surfaces, input.all, input.counting);
  const waiting = new Map(missing.map((m) => [m.surface, m]));
  const closes: number[] = [];
  const held = new Map<number, string>();
  for (const step of input.steps) {
    const own = step.files.some(isScreenFile) ? step.surfaces.filter((s) => waiting.has(s)) : [];
    if (own.length === 0) {
      closes.push(step.number);
      continue;
    }
    held.set(
      step.number,
      `its screens wait on ${name}'s land review: ${own.map((s) => describe(waiting.get(s)!)).join(', ')}. ` +
        `On the feature branch head, before the merge to main: npm run ui-guard -- ${input.feature} --feature --compare, ` +
        `then the critic on what it leaves, one round per page (npm run ui-guard -- ${input.feature} --feature --sheets), ` +
        `recorded with npm run ui-check -- ${input.feature} <surface> <round> --commit <head> [--states …]. ` +
        `A round counts only when its commit holds every built step's. ` +
        personHeldSentence(own.map((s) => waiting.get(s)!), `${input.feature} --feature`),
    );
  }
  return { closes, held };
}

/** One page's surfaces, judged as one sheet. */
export type PageGroup = {
  /** The page they share: the first route of the main state, or the surface itself when it has none. */
  route: string;
  /** Shot at four sizes and judged as the page. */
  main: string;
  /** The page's other states, drawn as a strip beside it. */
  states: string[];
};

/**
 * The surfaces grouped by the page they stand for (the first route in
 * `SURFACE_ROUTES`), in the order given. The main state is the surface whose
 * id the most others in the group extend (`goals-hours` for
 * `goals-hours-day-empty`), the first given on a tie.
 */
export function pageGroups(
  surfaces: readonly string[],
  routes: Readonly<Record<string, readonly string[]>> = SURFACE_ROUTES,
): PageGroup[] {
  const byRoute = new Map<string, string[]>();
  for (const surface of [...new Set(surfaces)]) {
    const route = routes[surface]?.[0] ?? surface;
    const list = byRoute.get(route) ?? [];
    list.push(surface);
    byRoute.set(route, list);
  }
  return [...byRoute].map(([route, list]) => {
    const extends_ = (base: string) => list.filter((s) => s !== base && s.startsWith(`${base}-`)).length;
    let main = list[0]!;
    for (const surface of list) if (extends_(surface) > extends_(main)) main = surface;
    return { route, main, states: list.filter((s) => s !== main) };
  });
}
