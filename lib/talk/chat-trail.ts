import { moduleForPath, type ModuleId } from '@/lib/modules';
import { isShownLookup, turnLookups, type LookupLine } from './lookups';
import type { TalkCitation, TalkFile, TalkTurn } from './talk';

/**
 * What Dash used in one chat (plan #1899.4), for the column beside it on
 * /ask: the rows it read, the lookups it ran, the files sent to it and what
 * the chat has cost. Nothing here is stored; all of it is worked out from
 * what the turns already keep and from the spend ledger. No database and no
 * React, so the page, the gallery and the tests share it.
 */

/** A row Dash read, with the workspace its address opens in (null for Gmail and the like). */
export type ReadRow = TalkCitation & { workspace: ModuleId | null };

function asCitation(row: unknown): TalkCitation | null {
  if (!row || typeof row !== 'object') return null;
  const { table, ref, title, href } = row as Record<string, unknown>;
  if (typeof table !== 'string' || typeof ref !== 'string' || typeof title !== 'string' || typeof href !== 'string') {
    return null;
  }
  return { table, ref, title, href };
}

/**
 * Every row Dash read in the chat, once each, in the order first met: the
 * rows each answer cites and the rows its lookups gave back. Rows a write
 * gave back are its change, listed with the changes instead.
 */
export function chatReadRows(turns: readonly Pick<TalkTurn, 'toolCalls' | 'citations'>[]): ReadRow[] {
  const seen = new Set<string>();
  const rows: ReadRow[] = [];
  const add = (row: TalkCitation | null) => {
    if (!row) return;
    const key = `${row.table}\u0000${row.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...row, workspace: moduleForPath(row.href) });
  };
  for (const turn of turns) {
    for (const call of turn.toolCalls ?? []) {
      if (!isShownLookup(call.name)) continue;
      const found = call.result && typeof call.result === 'object' ? (call.result as { rows?: unknown }).rows : null;
      if (Array.isArray(found)) found.forEach((row) => add(asCitation(row)));
    }
    for (const citation of turn.citations ?? []) add(asCitation(citation));
  }
  return rows;
}

/** Every lookup the chat's answers ran, in order, as the fold under each answer words them. */
export function chatLookups(turns: readonly Pick<TalkTurn, 'toolCalls'>[]): LookupLine[] {
  return turns.flatMap((turn, t) =>
    turnLookups(turn.toolCalls).map((line) => ({ ...line, id: `${t}-${line.id}` })),
  );
}

/** The files the person sent in the chat, in order. */
export function chatFiles(turns: readonly Pick<TalkTurn, 'files'>[]): TalkFile[] {
  return turns.flatMap((turn) => turn.files ?? []);
}

/** One ledger row as the cost needs it. */
export type SpendMark = { createdAt: string; costMicros: number | null };

/**
 * What the chat's answers cost, in micro-dollars, or null when the ledger
 * holds nothing for them. The ledger does not name the chat a call was for,
 * so each answer's cost is what was spent asking Dash between the question
 * and the answer being kept: the ask route records its spend before it
 * writes the answer. `spend` is the ledger's rows for asking Dash.
 */
export function chatCostMicros(
  turns: readonly Pick<TalkTurn, 'role' | 'createdAt'>[],
  spend: readonly SpendMark[],
): number | null {
  const windows: [number, number][] = [];
  let asked: number | null = null;
  for (const turn of turns) {
    const at = Date.parse(turn.createdAt);
    if (turn.role === 'user') asked = asked ?? at;
    else if (asked !== null) {
      windows.push([asked, at]);
      asked = null;
    }
  }
  let total = 0;
  let found = false;
  for (const mark of spend) {
    const at = Date.parse(mark.createdAt);
    if (!windows.some(([from, to]) => at >= from && at <= to)) continue;
    found = true;
    total += mark.costMicros ?? 0;
  }
  return found ? total : null;
}

/** The span the chat's answers were written in, for reading the ledger once. */
export function chatSpan(turns: readonly Pick<TalkTurn, 'createdAt'>[]): { from: string; to: string } | null {
  if (turns.length === 0) return null;
  const times = turns.map((turn) => turn.createdAt).sort();
  return { from: times[0], to: times[times.length - 1] };
}
