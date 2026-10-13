import { DASH_TOOLS, type DashTool } from '@/lib/dash/registry';
import { moduleById, type ModuleId } from '@/lib/modules';
import { AGENT_ACTIONS, entryTools, type CataloguedAction } from './catalogue';
import { NO_TOOL_REASONS, NO_TOOL_REASON_LABELS, type NoToolReason } from './types';

/**
 * The catalogue as the specs page draws it (plan #1895): how many of the
 * things the pages let the person do Dash has a tool for, how many no agent
 * should do and why, and how many are still gaps, with every action listed
 * by workspace. Plain data, so the gallery can draw it from fixtures.
 */

/** Where a tool is offered, in the page's words. */
export type ToolWhere = 'connector' | 'ask' | 'thread' | 'capture';

export const TOOL_WHERE_LABELS: Readonly<Record<ToolWhere, string>> = {
  connector: 'Connector and Ask Dash',
  ask: 'Ask Dash',
  thread: 'A thread on the row',
  capture: 'The capture box',
};

export type AgentActionRow = {
  name: string;
  file: string;
  kind: 'tool' | 'none' | 'gap';
  tools: { name: string; where: ToolWhere }[];
  reason: NoToolReason | null;
  note: string | null;
};

export type AgentActionGroup = {
  workspace: ModuleId | null;
  label: string;
  tool: number;
  none: number;
  gap: number;
  rows: AgentActionRow[];
};

export type AgentActionSummary = {
  total: number;
  tool: number;
  none: number;
  gap: number;
  /** Every reason with at least one action, most used first. */
  reasons: { reason: NoToolReason; label: string; sentence: string; count: number }[];
  groups: AgentActionGroup[];
};

function whereOf(tool: DashTool | undefined): ToolWhere {
  if (!tool) return 'ask';
  if (tool.kind === 'lookup') return tool.inAppOnly ? 'ask' : 'connector';
  if (!tool.subjects) return 'ask';
  return tool.subjects.includes('goals.captures') ? 'capture' : 'thread';
}

function rowOf(action: CataloguedAction, tools: ReadonlyMap<string, DashTool>): AgentActionRow {
  const { entry } = action;
  return {
    name: action.name,
    file: action.file,
    kind: 'tool' in entry ? 'tool' : 'gap' in entry ? 'gap' : 'none',
    tools: entryTools(entry).map((name) => ({ name, where: whereOf(tools.get(name)) })),
    reason: 'none' in entry ? entry.none : null,
    note: entry.note ?? null,
  };
}

function counted<T extends { kind: AgentActionRow['kind'] }>(rows: readonly T[]) {
  return {
    tool: rows.filter((r) => r.kind === 'tool').length,
    none: rows.filter((r) => r.kind === 'none').length,
    gap: rows.filter((r) => r.kind === 'gap').length,
  };
}

export function summariseAgentActions(
  actions: readonly CataloguedAction[] = AGENT_ACTIONS,
  dashTools: readonly DashTool[] = DASH_TOOLS,
): AgentActionSummary {
  const tools = new Map(dashTools.map((t) => [t.name, t]));
  const rows = actions.map((a) => ({ workspace: a.workspace, row: rowOf(a, tools) }));

  const workspaces = [...new Set(rows.map((r) => r.workspace))];
  const groups = workspaces.map((workspace): AgentActionGroup => {
    const mine = rows.filter((r) => r.workspace === workspace).map((r) => r.row);
    return {
      workspace,
      label: moduleById(workspace)?.label ?? 'Across the app',
      ...counted(mine),
      rows: mine,
    };
  });

  const reasonCounts = new Map<NoToolReason, number>();
  for (const { row } of rows) {
    if (row.reason) reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
  }
  const reasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      label: NO_TOOL_REASON_LABELS[reason],
      sentence: NO_TOOL_REASONS[reason],
      count,
    }));

  return { total: rows.length, ...counted(rows.map((r) => r.row)), reasons, groups };
}
