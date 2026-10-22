/**
 * What Dash mentions about a passive goal (docs/GOALS-SPEC.md, "Active and
 * passive goals"; plan #2503.5).
 *
 * A passive goal asks for no attention, so nothing under it reaches Do next,
 * Todo or the verdicts. A dated thing coming up under it within
 * MENTION_DAYS is still worth one quiet line: a step of yours with a due
 * date, or a suggestion (an event, say) with a date you have not answered.
 * The morning brief asks Dash to mention each once in the home's note,
 * marked optional, and the Goals home lists them as plain lines with
 * Dismiss. goals.mentions (goals migration 0087) records which the note has
 * mentioned and which you dismissed; a dismissed one never comes back.
 *
 * The rules that need no database live here. The reads and writes are in
 * lib/goals/mentions-store.ts.
 */
import type { StepNode } from '@/lib/goals/steps';
import type { Suggestion } from '@/lib/goals/suggestions';
import { toGoalActivity, type Goal } from '@/lib/goals/tree';
import { addDays } from '@/lib/todo/tasks/model';

/** How far ahead a date is mentioned: the near-date rule Todo uses for a step of yours. */
export const MENTION_DAYS = 7;

export type PassiveMention = {
  /** `step:<id>` or `suggestion:<id>`, the row's ref in goals.mentions. */
  ref: string;
  title: string;
  /** YYYY-MM-DD, today to MENTION_DAYS ahead. */
  on: string;
  goalId: string;
  goalTitle: string;
  /** Where Open goes: the goal's page, or the suggestion's own link. */
  href: string;
};

/** What goals.mentions holds for a ref, as the rules here read it. */
export type MentionState = { mentioned: boolean; dismissed: boolean };

export const stepRef = (id: string) => `step:${id}`;
export const suggestionRef = (id: string) => `suggestion:${id}`;

function contains(nodes: StepNode[], id: string): boolean {
  return nodes.some((n) => n.id === id || contains(n.children, id));
}

/**
 * Every dated thing coming up under a passive open goal, soonest first,
 * leaving out what you dismissed. A step counts when it is yours (`mine`),
 * open, not on Todo already, and due from today to MENTION_DAYS ahead. A
 * suggestion counts when it is not a suggested step, nobody has answered it,
 * and it happens in the same window. Pass the goals already narrowed to the
 * passive ones or not: an active goal is skipped either way.
 */
export function passiveMentions(input: {
  goals: readonly Goal[];
  byGoal: Map<string, StepNode[]>;
  suggestions?: readonly Suggestion[];
  today: string;
  states?: Map<string, MentionState>;
}): PassiveMention[] {
  const last = addDays(input.today, MENTION_DAYS);
  const inWindow = (on: string | null): on is string => !!on && on >= input.today && on <= last;
  const dismissed = (ref: string) => input.states?.get(ref)?.dismissed === true;
  const passive = input.goals.filter(
    (g) => g.status === 'open' && toGoalActivity(g.activity) === 'passive',
  );
  const out: PassiveMention[] = [];
  for (const goal of passive) {
    const href = `/goals/${goal.id}`;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status === 'dropped' || node.status === 'done') continue;
        if (
          node.kind === 'mine' &&
          node.status === 'open' &&
          !node.onTodo &&
          inWindow(node.dueOn) &&
          !dismissed(stepRef(node.id))
        ) {
          out.push({
            ref: stepRef(node.id),
            title: node.title,
            on: node.dueOn,
            goalId: goal.id,
            goalTitle: goal.title,
            href,
          });
        }
        walk(node.children);
      }
    };
    const roots = input.byGoal.get(goal.id) ?? [];
    walk(roots);
    for (const s of input.suggestions ?? []) {
      if (s.kind === 'step' || s.reaction !== null || s.attended !== null) continue;
      if (!s.itemId || (s.itemId !== goal.id && !contains(roots, s.itemId))) continue;
      if (!inWindow(s.happensOn) || dismissed(suggestionRef(s.id))) continue;
      out.push({
        ref: suggestionRef(s.id),
        title: s.title,
        on: s.happensOn,
        goalId: goal.id,
        goalTitle: goal.title,
        href: s.url ?? href,
      });
    }
  }
  return out.sort((a, b) => (a.on === b.on ? a.title.localeCompare(b.title) : a.on < b.on ? -1 : 1));
}

/** The mentions a morning brief lists: those the note has not mentioned yet. */
export function unmentioned(
  mentions: readonly PassiveMention[],
  states: Map<string, MentionState>,
): PassiveMention[] {
  return mentions.filter((m) => states.get(m.ref)?.mentioned !== true);
}

/** One line of the morning brief for a mention. */
export function mentionLine(m: PassiveMention): string {
  return `- "${m.title}" on ${m.on}, under the passive goal "${m.goalTitle}" (${m.ref.replace(':', ' ')})`;
}
