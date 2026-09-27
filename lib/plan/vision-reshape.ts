import { MODULES } from '@/lib/modules';
import { APP_VISION, type VisionScope } from '@/lib/specs/vision';
import { DISMISSAL_RULE, PLAIN_ENGLISH_RULE, QUESTION_RULE } from './brief';
import { isClosed, isDismissed } from './load';
import type { PlanNode, PlanSection } from './tree';

/**
 * The re-shape that follows an accepted vision edit (plan #1137).
 *
 * #1109 settled that accepting a new vision for a workspace also re-reads
 * every open feature there against it, the same day, and that whatever the
 * re-read wants to change comes back for the person to approve. So one run
 * per accept, not one per feature, and a run that writes only proposals and
 * questions: a feature the new vision calls for goes in proposed, and a step
 * or feature it would drop is asked about rather than dropped.
 *
 * Pure, so the rule about which features are read and what the run is told
 * can be tested without a database or a routine. The procedure itself is in
 * .claude/skills/plan/reference/reshaping.md, under "After a vision edit".
 */

/**
 * The features a re-shape after a vision edit reads: the top-level rows of the
 * workspace's plan that are not finished and not put aside. The app's own
 * vision covers the trees filed under no workspace, the same rule the brief
 * uses to pick a vision (`visionFor`).
 */
export function openFeaturesIn(
  sections: readonly PlanSection[],
  scope: VisionScope,
): PlanNode[] {
  const moduleId = scope === APP_VISION ? null : scope;
  const section = sections.find((candidate) => candidate.module === moduleId);
  if (!section) return [];
  return section.nodes.filter((node) => !isClosed(node.status) && !isDismissed(node));
}

/** What the workspace is called in the turn: its label, or the app. */
export function scopeLabel(scope: VisionScope): string {
  if (scope === APP_VISION) return 'the app as a whole';
  return MODULES.find((module) => module.id === scope)?.label ?? scope;
}

/** The turn appended to the plan routine's session. */
export function visionReshapeText(input: {
  scope: VisionScope;
  /** The vision as it stood before the accept; null when there was none. */
  before: string | null;
  after: string;
  features: readonly Pick<PlanNode, 'number' | 'title' | 'status'>[];
}): string {
  const label = scopeLabel(input.scope);
  const moduleFlag = input.scope === APP_VISION ? '' : ` --module ${input.scope}`;
  const list = input.features
    .map((feature) => `- #${feature.number} ${feature.title} (${feature.status.replace('_', ' ')})`)
    .join('\n');

  return (
    `Re-shape the open features in ${label} against its new vision, following ` +
    '"After a vision edit" in .claude/skills/plan/reference/reshaping.md. The person has ' +
    'just accepted a new vision for this workspace. Read each feature listed below ' +
    '(plan.ts show <n>) against the new vision and the code, and write back what the new ' +
    'vision changes.\n\n' +
    'You leave only proposals and questions. Nothing you write is ready to build, and ' +
    'nothing is dropped by you:\n' +
    '- A step or a whole feature the new vision makes pointless gets a decision under that ' +
    'feature, "Drop #<n> now that the vision says …?", with A to drop it and B to keep it ' +
    'and your recommendation. Never run plan.ts drop.\n' +
    `- Work the new vision calls for that no open feature covers is a new feature, added with --proposed and no --parent${moduleFlag}, whose detail opens by naming the part of the vision it serves.\n` +
    '- Work the new vision calls for inside a feature already listed is a step added with ' +
    '--proposed under it, even though the feature is approved.\n\n' +
    'Do not approve anything, answer a decision, start or build a step, graduate or ' +
    'rewrite fog, or add again what a feature already holds. A feature the new vision ' +
    'leaves as it was gets nothing. You change rows, not code: do not commit or push. ' +
    'Report, by number and title, what you proposed and which drops you asked about, and ' +
    `which features you read and left alone.\n\n${PLAIN_ENGLISH_RULE}\n\n${QUESTION_RULE}\n\n${DISMISSAL_RULE}\n\n` +
    `## The new vision\n\n${input.after.trim()}\n\n` +
    `## The vision it replaced\n\n${input.before?.trim() || 'Nothing was written before.'}\n\n` +
    `## Open features in ${label}\n\n${list}`
  );
}
