/**
 * What a module says about the things its pages let the person do (plan
 * #1895, feature #1894): for each server action, the Dash tool that does the
 * same, the reason no agent should, or that one should and has no tool yet.
 *
 * The app's vision has everything a person can do in the app also done by an
 * agent. This is how that is kept honest. Every function exported from a
 * `'use server'` module under app/ is listed in its module's
 * `agent-actions.ts`, and lib/agent-actions/catalogue.ts gathers them. The
 * gate refuses an action in none of the three
 * (lib/agent-actions/catalogue.test.ts), and the third is counted by the
 * `agent-action-gaps` counter in scripts/spec-counts.ts, which may go down and
 * never up. So a new page cannot add an action no agent can reach without
 * saying why, and cannot add one more gap without closing another.
 *
 * Modelled on lib/sources/types.ts, which does the same for tables.
 */

/**
 * Why no agent should do an action, in the words the specs page shows.
 * A reason is a judgement about the action, not about the tools there are
 * today: "an agent should and cannot yet" is a gap, never a reason.
 */
export const NO_TOOL_REASONS = {
  account: "Signing in, the account and the services it connects to are the person's own.",
  setting: 'A setting or display preference the person chooses for themselves.',
  page: 'Serves the page itself, such as a poll, a count, a search for a picker or a preview before saving.',
  deletes: 'Deletes, and Dash never deletes.',
  theirs:
    "The person's word to Dash: an answer, an approval, a verdict on a suggestion, a comment in a thread, or taking back what Dash did.",
  own: "The person's own reading, study or writing, such as an answer, a rating, a skip or an essay draft, which means something only when they do it.",
  spends:
    'Starts a model run or a Dash routine on the account, which spends money the person chooses to spend.',
  outside: 'Acts outside the app or changes who can see something, which waits for the person.',
  session:
    'A build session does it with the plan or notes command as it works a step or a note, so the agent that should do it already can.',
} as const;

export type NoToolReason = keyof typeof NO_TOOL_REASONS;

export const NO_TOOL_REASON_LABELS: Readonly<Record<NoToolReason, string>> = {
  account: 'Account',
  setting: 'Setting',
  page: 'Page only',
  deletes: 'Deletes',
  theirs: 'Their word',
  own: 'Their own work',
  spends: 'Spends',
  outside: 'Outside the app',
  session: 'Session',
};

export type ActionEntry =
  /** An agent does it with this Dash tool, or these (lib/dash/registry.ts). */
  | { tool: string | readonly string[]; note?: string }
  /** No agent should. */
  | { none: NoToolReason; note?: string }
  /** An agent should and has no tool for it yet. */
  | { gap: true; note?: string };

/** One `'use server'` file's exports, by name. */
export type ActionFile = Readonly<Record<string, ActionEntry>>;

/** A module's server action files, by path from the repository root (`app/todo/actions.ts`). */
export type ModuleActions = Readonly<Record<string, ActionFile>>;

/** Done by this tool, or by any of these. */
export function tool(...names: string[]): ActionEntry {
  return { tool: names.length === 1 ? names[0] : names };
}

/** No agent should, for this reason. */
export function none(reason: NoToolReason, note?: string): ActionEntry {
  return note ? { none: reason, note } : { none: reason };
}

/** An agent should and cannot yet. */
export const GAP: ActionEntry = { gap: true };

/** A gap with a word on what the tool would be, or which step closes it. */
export function gap(note: string): ActionEntry {
  return { gap: true, note };
}
