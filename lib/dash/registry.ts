import type Anthropic from '@anthropic-ai/sdk';
import { ASK_TOOLS, IN_APP_ONLY_TOOLS } from '@/lib/ask/tools';
import { PROPOSAL_TOOLS } from '@/lib/ask/propose';
import type { AskContext } from '@/lib/ask/db';
import type { DashAction, DashActionOp } from '@/lib/core/dash-actions';
import { HAND_OFF_TOOL } from '@/lib/talk/handoff';

/**
 * Every tool Dash can call, on any surface (plan #1463, feature #1462;
 * docs/CORE-AND-DASH-SPEC.md, Part 6).
 *
 * One list, one shape. Each entry names the tool, says what kind it is, and
 * carries the definition the model is sent (name, description, input schema).
 * The loop in lib/dash/loop.ts sends a surface's tools in registry order and
 * routes each call by its kind:
 *
 *   lookup    reads the person's rows; run by executeAskTool (lib/ask/tools.ts).
 *   proposal  checks a change and keeps it as a proposed row in
 *             core.dash_actions for the person to confirm (lib/ask/propose.ts).
 *   handoff   passes a request no tool can do to the backup routine
 *             (lib/talk/handoff.ts).
 *   write     changes a row straight away and carries an Undo. None is
 *             registered yet; #1440 adds the first.
 *
 * The lookup and proposal code stays where it is: this file lists the tools
 * and does not run them. A write tool is different, since what it does is
 * declared with it: `apply` makes the change and says which row it touched
 * and how, which is what core.dash_actions records (Part 5), and `undo` is
 * there only when undoDashAction's generic rule cannot put it back.
 *
 * `answer` is not here. It is how the loop ends a turn, not something Dash
 * can do, and the loop adds it after a surface's tools.
 */

export type DashToolKind = 'lookup' | 'proposal' | 'handoff' | 'write';

type DashToolBase = {
  name: string;
  /** Sent to the model as it is. Its name is the tool's name. */
  definition: Anthropic.Tool;
  /** Kept in the app: the connector (lib/connector/mcp.ts) does not offer it. */
  inAppOnly?: boolean;
};

export type DashLookupTool = DashToolBase & { kind: 'lookup' };
export type DashProposalTool = DashToolBase & { kind: 'proposal' };
export type DashHandoffTool = DashToolBase & { kind: 'handoff' };

/** What a write is run with: the person's clients and workspaces, and the rows Dash has seen. */
export type DashWriteContext = AskContext & {
  /** Whether a lookup in this conversation returned the row, or the page shows it. */
  seen: (table: string, ref: string) => boolean;
};

/** What a write tool reports about the change it made, in the shape core.dash_actions keeps. */
export type DashWriteResult =
  | {
      ok: true;
      /** What was done, in snake_case: `add_goal`, `close_todo`. */
      kind: string;
      /** `schema.table:id`, the row written. */
      subjectRef: string;
      op: DashActionOp;
      /** The whole row before the write, for an update or a delete. */
      before: Record<string, unknown> | null;
      /** The row after the write, for an insert or an update. */
      after: Record<string, unknown> | null;
      /** The sentence the person reads for it, naming Dash. */
      summary: string;
      /** What undoing needs beyond the row, kept in the `undo` column. */
      undo?: Record<string, unknown> | null;
    }
  | { ok: false; error: string };

export type DashWriteTool = DashToolBase & {
  kind: 'write';
  /** Validates the input, makes the change, and says what it changed. Never throws. */
  apply: (ctx: DashWriteContext, input: unknown) => Promise<DashWriteResult>;
  /**
   * Puts the change back, for a write the generic rule (undoDashAction in
   * lib/core/dash-actions.ts) cannot undo, such as one that touches two rows.
   * Absent: the generic rule undoes it from before and after.
   */
  undo?: (ctx: AskContext, action: DashAction) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export type DashTool = DashLookupTool | DashProposalTool | DashHandoffTool | DashWriteTool;

const IN_APP = new Set<string>(IN_APP_ONLY_TOOLS);

/** The tools in the order the model is sent them, which keeps the cached prefix stable. */
export const DASH_TOOLS: readonly DashTool[] = [
  ...ASK_TOOLS.map(
    (definition): DashLookupTool => ({
      name: definition.name,
      kind: 'lookup',
      definition,
      ...(IN_APP.has(definition.name) ? { inAppOnly: true } : {}),
    }),
  ),
  ...PROPOSAL_TOOLS.map((definition): DashProposalTool => ({ name: definition.name, kind: 'proposal', definition })),
  { name: HAND_OFF_TOOL.name, kind: 'handoff', definition: HAND_OFF_TOOL },
];

const BY_NAME = new Map(DASH_TOOLS.map((tool) => [tool.name, tool]));

/** The registered tool of that name, or undefined for a name the model made up. */
export function dashTool(name: string, tools: readonly DashTool[] = DASH_TOOLS): DashTool | undefined {
  return tools === DASH_TOOLS ? BY_NAME.get(name) : tools.find((tool) => tool.name === name);
}

/** The tools of one kind, in registry order. */
export function dashToolsOf<K extends DashToolKind>(
  kind: K,
  tools: readonly DashTool[] = DASH_TOOLS,
): Extract<DashTool, { kind: K }>[] {
  return tools.filter((tool): tool is Extract<DashTool, { kind: K }> => tool.kind === kind);
}
