/**
 * Changes Dash proposes to a spec, and what the weekly audit found that led to
 * them (plan #1505, docs/SPEC-LAYER-SPEC.md parts 2 and 3). Stored in
 * `spec_changes` and `spec_findings` (supabase/migrations/0155).
 *
 * A change is the diff to one spec's markdown, with a title and a why. The
 * person approves or declines it on /dev/specs; an approved change is
 * committed to docs/ and marked applied. The database refuses a diff over
 * MAX_CHANGED_LINES, counted by `spec_diff_changed_lines`, which
 * `countChangedLines` here mirrors so a draft can be checked before it is
 * written.
 *
 * Not `server-only`: the audit writes through a script outside Next.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SpecChangeStatus = 'proposed' | 'approved' | 'declined' | 'applied';
export type SpecChangeMadeBy = 'me' | 'claude';

export type SpecFindingKind = 'holds' | 'drifted' | 'missing' | 'undescribed' | 'missing_rule';
export type SpecFindingProposal = 'change_code' | 'change_spec' | 'none';

/** The most lines a change may add and remove between them. */
export const MAX_CHANGED_LINES = 60;

/**
 * The lines a unified diff adds or removes. File headers and anything before
 * the first `@@` are not counted; a `--- ` line followed by `+++ ` starts a
 * new file. The same rule as `spec_diff_changed_lines` in the migration.
 */
export function countChangedLines(diff: string): number {
  const lines = diff.replace(/\r/g, '').split('\n');
  let inHunk = false;
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff ')) {
      inHunk = false;
    } else if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      changed++;
    }
  }
  return changed;
}

/** Whether the database will take this diff: at least one change, at most the cap. */
export function diffFits(diff: string): boolean {
  const n = countChangedLines(diff);
  return n >= 1 && n <= MAX_CHANGED_LINES;
}

/** A change as the pages read it. */
export type SpecChange = {
  id: string;
  /** The spec's slug in lib/specs/registry.ts. */
  spec: string;
  title: string;
  why: string;
  diff: string;
  status: SpecChangeStatus;
  madeBy: SpecChangeMadeBy;
  /** The feature or overhaul it became, once shaped (plan #1509). */
  planItemId: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export const SPEC_CHANGE_COLUMNS =
  'id, spec, title, why, diff, status, made_by, plan_item_id, decided_at, created_at';

type SpecChangeRow = {
  id: string;
  spec: string;
  title: string;
  why: string;
  diff: string;
  status: SpecChangeStatus;
  made_by: SpecChangeMadeBy;
  plan_item_id: string | null;
  decided_at: string | null;
  created_at: string;
};

export function specChangeFrom(row: SpecChangeRow): SpecChange {
  return {
    id: row.id,
    spec: row.spec,
    title: row.title,
    why: row.why,
    diff: row.diff,
    status: row.status,
    madeBy: row.made_by,
    planItemId: row.plan_item_id,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/**
 * The changes still open: proposed ones waiting on the person, and approved
 * ones that have not reached docs/ yet. Oldest first, so a change drafted on
 * top of an earlier one is read after it.
 */
export async function loadOpenSpecChanges(
  supabase: SupabaseClient,
  userId: string,
): Promise<SpecChange[]> {
  const { data, error } = await supabase
    .from('spec_changes')
    .select(SPEC_CHANGE_COLUMNS)
    .eq('user_id', userId)
    .in('status', ['proposed', 'approved'])
    .order('created_at', { ascending: true });
  if (error) {
    console.error(`Could not read the spec changes: ${error.message}`);
    return [];
  }
  return ((data ?? []) as SpecChangeRow[]).map(specChangeFrom);
}

/** How many changes are waiting on the person, for the Home tab's badge. */
export async function countProposedSpecChanges(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('spec_changes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'proposed');
  return error ? 0 : (count ?? 0);
}

export type SpecChangeDecision = 'approved' | 'declined';

/**
 * Approve or decline a proposed change. Only a change still proposed is
 * touched, so a second press, or one from another tab, finds nothing and says
 * so. `decided_at` goes with the status because the table requires it on
 * every status but proposed.
 *
 * This only records the answer. Committing an approved diff to docs/ and
 * shaping it into work is plan #1509, started from the approve action once
 * this has returned.
 */
export async function decideSpecChange(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  decision: SpecChangeDecision,
): Promise<{ change: SpecChange } | { error: string }> {
  const { data, error } = await supabase
    .from('spec_changes')
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', id)
    .eq('status', 'proposed')
    .select(SPEC_CHANGE_COLUMNS)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'That change has already been decided.' };
  return { change: specChangeFrom(data as SpecChangeRow) };
}

/** One line of a diff as the page draws it. */
export type DiffLine =
  | { kind: 'add' | 'remove' | 'context'; text: string }
  /** A hunk's start, with the heading git names it by when there is one. */
  | { kind: 'hunk'; text: string };

/**
 * A unified diff as lines to draw: file headers and anything before the first
 * hunk dropped, the leading `+`, `-` or space taken off each line, and the
 * "No newline at end of file" marker left out. The same reading of hunks as
 * `countChangedLines`.
 */
export function diffLines(diff: string): DiffLine[] {
  const lines = diff.replace(/\r/g, '').split('\n');
  const out: DiffLine[] = [];
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff ')) {
      inHunk = false;
    } else if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      inHunk = false;
      i++;
    } else if (line.startsWith('@@')) {
      inHunk = true;
      out.push({ kind: 'hunk', text: line.replace(/^@@[^@]*@@\s?/, '').trim() });
    } else if (!inHunk || line.startsWith('\\')) {
      continue;
    } else if (line.startsWith('+')) {
      out.push({ kind: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      out.push({ kind: 'remove', text: line.slice(1) });
    } else {
      out.push({ kind: 'context', text: line.slice(1) });
    }
  }
  // A trailing newline leaves one empty context line behind it.
  const last = out.at(-1);
  if (last && last.kind === 'context' && last.text === '' && diff.endsWith('\n')) out.pop();
  return out;
}
