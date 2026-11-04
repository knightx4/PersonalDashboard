/**
 * Landing: putting a feature's built steps on main (plan #2815.2).
 *
 * A step a batch has built sits on the feature's branch, in progress with a
 * Built line, until the feature merges to main and `plan.ts land` closes it.
 * On 4 November 2026, 12 open features held about 45 such steps that no
 * session ever merged: a batch that stopped short left its branch for the next
 * one, and the next one built more instead of shipping what was there.
 *
 * So two rules. The overnight tick sends a `land` run at a feature that has
 * built steps and no session going, before it sends anything to build more.
 * And a batch stops building once its feature holds `LAND_AT_BUILT` built
 * steps, and lands them, so a long feature ships in pieces.
 *
 * Pure and browser-safe, so the choice is tested without a database.
 */
import { endsWithBuiltLine } from './built';
import { flatten, type PlanNode, type PlanSection } from './tree';

/** How many built steps a feature batch holds before it stops and lands them. */
export const LAND_AT_BUILT = 4;

/**
 * How long after a land run a feature may be sent another.
 *
 * A land session that finds the feature's app does not work without its
 * unbuilt steps says so and leaves the branch, and the feature still has
 * built steps. Without a wait the next tick would send it again, and every
 * tick after. Six hours matches `OVERNIGHT_RETRY_AFTER_MINUTES`.
 */
export const LAND_RETRY_AFTER_MINUTES = 6 * 60;

/** Whether a row is built on its feature branch and waiting to land. */
export function isBuilt(node: Pick<PlanNode, 'status' | 'comment'>): boolean {
  return node.status === 'in_progress' && endsWithBuiltLine(node.comment);
}

/** The steps beneath a feature that are built and waiting to land, in plan order. */
export function builtSteps(feature: PlanNode): PlanNode[] {
  return flatten(feature.children).filter(isBuilt);
}

/**
 * The features the tick should send a land run at, most built steps first.
 *
 * A feature qualifies when it is approved and open, holds at least one built
 * step, has no session going (`runningIds`), is not held by the stall check
 * (`heldIds`), and was not sent a land run in the last
 * `LAND_RETRY_AFTER_MINUTES` (`lastLandAt`). Whether the app works with the
 * rest of the feature missing is for the session to check: the tree cannot
 * say.
 */
export function featuresToLand(
  sections: readonly PlanSection[],
  input: {
    runningIds: readonly string[];
    heldIds?: readonly string[];
    /** When each feature was last sent a land run, by feature id. */
    lastLandAt?: Readonly<Record<string, string>>;
    now: number;
  },
): Array<{ feature: PlanNode; built: PlanNode[] }> {
  const skip = new Set([...input.runningIds, ...(input.heldIds ?? [])]);
  const retryMs = LAND_RETRY_AFTER_MINUTES * 60_000;
  const out: Array<{ feature: PlanNode; built: PlanNode[]; order: number }> = [];
  let order = 0;
  for (const section of sections) {
    for (const feature of section.nodes) {
      order += 1;
      if (skip.has(feature.id)) continue;
      if (feature.status === 'done' || feature.status === 'dropped') continue;
      if (feature.status === 'proposed') continue;
      const landed = input.lastLandAt?.[feature.id];
      if (landed && input.now - new Date(landed).getTime() < retryMs) continue;
      const built = builtSteps(feature);
      if (built.length > 0) out.push({ feature, built, order });
    }
  }
  return out
    .sort((a, b) => b.built.length - a.built.length || a.order - b.order)
    .map(({ feature, built }) => ({ feature, built }));
}

/** What a land session is told, ahead of the brief. */
export function landTurn(
  feature: { outline: string; title: string },
  built: readonly { outline: string; title: string }[],
): string {
  const n = feature.outline;
  const steps = built.map((step) => `- #${step.outline} ${step.title}`);
  return [
    `Land plan feature #${n}, "${feature.title}": put the steps already built on its branch ` +
      'onto main. This is not the build job: do not build or claim any step.',
    '',
    `Built and waiting, ${built.length === 1 ? 'one step' : `${built.length} steps`}:`,
    ...steps,
    '',
    "Follow the part of .claude/skills/plan/SKILL.md headed \"When the feature's steps are " +
      'built", on the feature branch the Built lines name. First check that the app ' +
      'works with the rest of the feature missing: no page, link, migration or test on the ' +
      'branch may need a step that is not built yet. If it does, land nothing, and write why ' +
      `with plan.ts stopped ${n} --reason "<what still needs which step>". Otherwise merge ` +
      `origin/main into the branch, run npm run gate, merge to main with --no-ff, push, and run ` +
      `plan.ts land ${n}. Report which steps closed, by outline and title, and whether the ` +
      'feature reached main.',
  ].join('\n');
}

/**
 * The line `plan.ts built` prints once a feature holds enough built steps to
 * land, or null below that. `feature` is its reference as written, `#2815`.
 */
export function landNowLine(feature: string, built: number): string | null {
  if (built < LAND_AT_BUILT) return null;
  return (
    `${feature} now holds ${built} built steps. Stop sending steps and land them: ` +
    "the Building section of .claude/skills/plan/SKILL.md, \"When the feature's steps are built\"."
  );
}
