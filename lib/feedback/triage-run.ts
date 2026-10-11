import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { askJevAll } from '@/lib/jev/client';
import { OUTSTANDING_STATUSES, NOTES_WORK_KINDS } from '@/lib/feedback/load';
import {
  TRIAGE_KIND_QUESTION,
  TRIAGE_MAX_CANDIDATES,
  TRIAGE_MODULE_QUESTION,
  TRIAGE_PRIORITY_QUESTION,
  TRIAGE_ROUTE_QUESTION,
  TRIAGE_TIMEOUT_MS,
  duplicateQuestion,
  isSure,
  noteColumns,
  readTriage,
  triageState,
  type Triage,
  type TriageCandidate,
  type TriageTable,
} from '@/lib/feedback/triage';
import { readPathOpens30 } from '@/lib/usage/opens';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public'>;

/**
 * Ask Jev the five triage questions about one note or idea that was just
 * filed, and store the answers on its row (plan #1179). The caller has
 * already checked the account agreed to send text to Jev.
 *
 * A note's `priority` and `kind` columns take Jev's answers when Jev is sure
 * of them, since nobody has set either yet: the header files a bug and a
 * request from one tab (note 55b53dc9), so the kind it saves is a placeholder.
 * A Someday on a page opened often is stored as Normal (noteColumns, plan
 * #1643). Everything else lives in `triage` only.
 *
 * Returns null, and writes nothing, when the row is not the caller's, is a
 * like, or Jev could not answer. Spend goes to `spend` whatever happens.
 */
export async function triageRow(
  supabase: Client,
  input: { userId: string; table: TriageTable; id: string; spend: SpendReport[] },
): Promise<Triage | null> {
  const { userId, table, id } = input;
  const row = await readFiled(supabase, userId, table, id);
  if (!row) return null;

  const candidates = await openItems(supabase, userId, { table, id });
  const { question: duplicate, keys } = duplicateQuestion(candidates);

  const result = await askJevAll({
    state: triageState({ body: row.body, filedAs: row.filedAs, pagePath: row.pagePath }),
    questions: {
      kind: TRIAGE_KIND_QUESTION,
      module: TRIAGE_MODULE_QUESTION,
      priority: TRIAGE_PRIORITY_QUESTION,
      route: TRIAGE_ROUTE_QUESTION,
      duplicate,
    },
    onSpend: (report) => input.spend.push(report),
    timeoutMs: TRIAGE_TIMEOUT_MS,
  });
  if (!result.ok) {
    if (result.reason !== 'no-key') console.warn(`[triage] ${result.reason}: ${result.detail}`);
    return null;
  }

  const triage = readTriage(result.answers, keys);
  if (!triage.kind && !triage.module && !triage.priority && !triage.route && !triage.duplicate) {
    return null;
  }

  let update: Record<string, unknown> = { triage };
  if (table === 'feedback_items') {
    // Only a sure Someday can move, so the page's opens are read for that alone.
    const someday = triage.priority?.value === 3 && isSure(triage.priority);
    const opens30 = someday && row.pagePath ? await readPathOpens30(supabase, userId, row.pagePath) : null;
    update = { ...update, ...noteColumns(triage, opens30) };
  }
  const { error } = await supabase.from(table).update(update).eq('id', id).eq('user_id', userId);
  if (error) {
    console.warn(`[triage] could not store: ${error.message}`);
    return null;
  }
  return triage;
}

type Filed = { body: string; filedAs: 'note' | 'idea'; pagePath: string | null };

async function readFiled(
  supabase: Client,
  userId: string,
  table: TriageTable,
  id: string,
): Promise<Filed | null> {
  if (table === 'ideas') {
    const { data } = await supabase
      .from('ideas')
      .select('body')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    return data ? { body: String(data.body), filedAs: 'idea', pagePath: null } : null;
  }
  const { data } = await supabase
    .from('feedback_items')
    .select('body, kind, page_path')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data || (data.kind !== 'bug' && data.kind !== 'feature')) return null;
  return {
    body: String(data.body),
    filedAs: 'note',
    pagePath: (data.page_path as string | null) ?? null,
  };
}

/**
 * The open notes and ideas a new one could repeat, newest first: notes still
 * to be worked, and ideas neither dismissed nor shaped into the plan. The row
 * just filed is left out.
 */
async function openItems(
  supabase: Client,
  userId: string,
  filed: { table: TriageTable; id: string },
): Promise<TriageCandidate[]> {
  const [notes, ideas] = await Promise.all([
    supabase
      .from('feedback_items')
      .select('id, body')
      .eq('user_id', userId)
      .in('status', [...OUTSTANDING_STATUSES])
      .in('kind', [...NOTES_WORK_KINDS])
      .order('created_at', { ascending: false })
      .limit(TRIAGE_MAX_CANDIDATES),
    supabase
      .from('ideas')
      .select('id, body')
      .eq('user_id', userId)
      .is('dismissed_at', null)
      .is('plan_item_id', null)
      .order('created_at', { ascending: false })
      .limit(TRIAGE_MAX_CANDIDATES),
  ]);
  const of = (table: TriageTable, rows: unknown): TriageCandidate[] =>
    ((rows ?? []) as Array<{ id: string; body: string }>)
      .filter((row) => !(table === filed.table && row.id === filed.id))
      .map((row) => ({ table, id: row.id, body: row.body }));
  // Notes first: there are few of them and they are the queue being worked.
  return [...of('feedback_items', notes.data), ...of('ideas', ideas.data)].slice(
    0,
    TRIAGE_MAX_CANDIDATES,
  );
}
