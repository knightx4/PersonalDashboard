/**
 * The Ask Dash answers that stopped because they used all their lookups
 * (plan #3092, migration 0317 core.dash_lookup_caps). The answer is forced at
 * 10 lookups (ANSWER_AT, plan #3093) and 12 stays the hard stop (MAX_LOOKUPS);
 * each answer that reaches the first is kept with its question, the
 * lookups in order, its time and cost, and listed newest first on Dev
 * (/dev/usage/lookups), so the owner can decide case by case whether
 * lookups should be done differently or the question handed to a session.
 *
 * Pure but for keepLookupCap and loadLookupCaps, which take the client.
 */

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { costMicrosFor, type SpendReport } from '@/lib/core/spend/pricing';
import type { TalkToolCall } from '@/lib/talk/talk';
import type { DashCall } from './loop';

export type LookupCapSurface = 'ask' | 'eval';

/** One lookup as kept: the tool, what it was given, and whether it worked. */
export type KeptLookup = { tool: string; input: unknown; ok: boolean };

/** What a recorder is told about an answer that ran out of lookups. */
export type LookupCap = {
  surface: LookupCapSurface;
  question: string;
  model: string;
  toolCalls: readonly TalkToolCall[];
  /** The answer's own flags, as the loop returned them. */
  answer: { extended?: true; cutShort?: true };
  /** Each model call, for whether the last one hit its length limit. */
  calls?: readonly DashCall[];
  spent: readonly SpendReport[];
  seconds: number;
  conversationId?: string | null;
  turnId?: string | null;
  pagePath?: string | null;
  scope?: string | null;
  evalRunId?: string | null;
  evalCaseId?: string | null;
};

/** A lookup's input longer than this, as JSON, is kept as its first characters. */
export const MAX_INPUT_CHARS = 2000;
/** More lookups than this are not kept one by one; the count still says how many. */
export const MAX_KEPT_LOOKUPS = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

/** An input as kept: itself, or its JSON cut to MAX_INPUT_CHARS under `trimmed`. */
export function keptInput(input: unknown): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(input);
  } catch {
    return { trimmed: String(input).slice(0, MAX_INPUT_CHARS) };
  }
  if (text === undefined) return null;
  return text.length > MAX_INPUT_CHARS ? { trimmed: text.slice(0, MAX_INPUT_CHARS) } : input;
}

/** The lookups in the order made. */
export function keptLookups(toolCalls: readonly TalkToolCall[]): KeptLookup[] {
  return toolCalls.slice(0, MAX_KEPT_LOOKUPS).map((call) => {
    const result = call.result as { ok?: unknown } | undefined;
    return { tool: call.name, input: keptInput(call.input), ok: result?.ok !== false };
  });
}

/** What the calls cost in millionths of a dollar, or null when no call could be priced. */
export function spentMicros(spent: readonly SpendReport[]): number | null {
  let total = 0;
  let priced = false;
  for (const report of spent) {
    const micros = costMicrosFor(report.model, report.usage);
    if (micros === null) continue;
    priced = true;
    total += micros;
  }
  return priced ? total : null;
}

/** Whether the answer lost words: cut to fit a turn, or its last reply stopped at its length limit. */
export function wasCutShort(answer: LookupCap['answer'], calls: readonly DashCall[] = []): boolean {
  return answer.cutShort === true || calls[calls.length - 1]?.stop === 'max_tokens';
}

/** The row an answer that ran out of lookups is kept as. */
export function lookupCapRow(userId: string, cap: LookupCap): Record<string, unknown> {
  const question = cap.question.trim() || '(no question)';
  return {
    user_id: userId,
    surface: cap.surface,
    question: question.slice(0, 8000),
    conversation_id: uuidOrNull(cap.conversationId),
    turn_id: uuidOrNull(cap.turnId),
    page_path: cap.pagePath && cap.pagePath.startsWith('/') ? cap.pagePath : null,
    scope: cap.scope ?? null,
    eval_run_id: uuidOrNull(cap.evalRunId),
    eval_case_id: uuidOrNull(cap.evalCaseId),
    lookups: keptLookups(cap.toolCalls),
    lookup_count: cap.toolCalls.length,
    extended: cap.answer.extended === true,
    cut_short: wasCutShort(cap.answer, cap.calls),
    seconds: Math.max(0, Math.round(cap.seconds * 10) / 10),
    cost_micros: spentMicros(cap.spent),
    model: cap.model.trim() || 'unknown',
  };
}

type Inserting = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } };

/** Keeps one answer that ran out of lookups. Never throws: a record not kept leaves the answer as it was. */
export async function keepLookupCap(core: Inserting, userId: string, cap: LookupCap): Promise<void> {
  try {
    const { error } = await core.from('dash_lookup_caps').insert(lookupCapRow(userId, cap));
    if (error) console.error('the answer that ran out of lookups was not recorded', error.message);
  } catch (error) {
    console.error('the answer that ran out of lookups was not recorded', error);
  }
}

/** One answer that ran out of lookups, as the Dev list draws it. */
export type LookupCapEntry = {
  id: string;
  at: string;
  surface: LookupCapSurface;
  question: string;
  conversationId: string | null;
  turnId: string | null;
  pagePath: string | null;
  scope: string | null;
  evalRunId: string | null;
  evalCaseId: string | null;
  lookups: KeptLookup[];
  lookupCount: number;
  extended: boolean;
  cutShort: boolean;
  seconds: number;
  costMicros: number | null;
  model: string;
};

/** How many the Dev list shows. */
export const LOOKUP_CAP_LIST_LIMIT = 100;

type CapRow = {
  id: string;
  created_at: string;
  surface: string;
  question: string;
  conversation_id: string | null;
  turn_id: string | null;
  page_path: string | null;
  scope: string | null;
  eval_run_id: string | null;
  eval_case_id: string | null;
  lookups: unknown;
  lookup_count: number;
  extended: boolean;
  cut_short: boolean;
  seconds: number | string;
  cost_micros: number | string | null;
  model: string;
};

function entryLookups(value: unknown): KeptLookup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as { tool?: unknown; input?: unknown; ok?: unknown } | null;
    if (!row || typeof row.tool !== 'string') return [];
    return [{ tool: row.tool, input: row.input ?? null, ok: row.ok !== false }];
  });
}

/** A row as the list draws it. */
export function lookupCapEntry(row: CapRow): LookupCapEntry {
  return {
    id: row.id,
    at: row.created_at,
    surface: row.surface === 'eval' ? 'eval' : 'ask',
    question: row.question,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    pagePath: row.page_path,
    scope: row.scope,
    evalRunId: row.eval_run_id,
    evalCaseId: row.eval_case_id,
    lookups: entryLookups(row.lookups),
    lookupCount: row.lookup_count,
    extended: row.extended,
    cutShort: row.cut_short,
    seconds: Number(row.seconds) || 0,
    costMicros: row.cost_micros === null ? null : Number(row.cost_micros),
    model: row.model,
  };
}

/** The newest answers that ran out of lookups, newest first. Null when they could not be read. */
export async function loadLookupCaps(core: CoreSupabaseClient, userId: string): Promise<LookupCapEntry[] | null> {
  try {
    const { data, error } = await core
      .from('dash_lookup_caps')
      .select(
        'id, created_at, surface, question, conversation_id, turn_id, page_path, scope, eval_run_id, eval_case_id, lookups, lookup_count, extended, cut_short, seconds, cost_micros, model',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LOOKUP_CAP_LIST_LIMIT);
    if (error) {
      console.error('the answers that ran out of lookups were not read', error.message);
      return null;
    }
    return ((data ?? []) as CapRow[]).map(lookupCapEntry);
  } catch (error) {
    console.error('the answers that ran out of lookups were not read', error);
    return null;
  }
}

/** A lookup's input as one line of text for the list. */
export function inputText(input: unknown): string {
  if (input && typeof input === 'object' && 'trimmed' in input && typeof (input as { trimmed: unknown }).trimmed === 'string') {
    return `${(input as { trimmed: string }).trimmed}…`;
  }
  if (input === null || input === undefined) return '';
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}
