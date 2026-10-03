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
import { COMMENT_COLUMNS, threadFrom, type DevComment } from '@/lib/comments/load';
import { splitSections, type SpecSection } from './sections';

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
  /** What you and Dash wrote under it, oldest first (plan #1507). */
  thread: DevComment[];
};

export const SPEC_CHANGE_COLUMNS =
  'id, spec, title, why, diff, status, made_by, plan_item_id, decided_at, created_at, ' +
  `dev_comments (${COMMENT_COLUMNS})`;

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
  /** Absent when a caller selected the change without its thread. */
  dev_comments?: unknown;
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
    thread: threadFrom(row.dev_comments),
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
  return ((data ?? []) as unknown as SpecChangeRow[]).map(specChangeFrom);
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
  return { change: specChangeFrom(data as unknown as SpecChangeRow) };
}

/** One change, with an empty thread, or null when it is not the user's. */
export async function loadSpecChange(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<SpecChange | null> {
  const { data } = await supabase
    .from('spec_changes')
    .select('id, spec, title, why, diff, status, made_by, plan_item_id, decided_at, created_at')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return specChangeFrom(data as SpecChangeRow);
}

/**
 * Put an approved change back to proposed, for when the run that writes it in
 * could not be started (plan #1509). Approving is the press that commits and
 * shapes it, so a press that started neither should leave the change as it
 * found it, ready to be pressed again.
 */
export async function reopenSpecChange(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('spec_changes')
    .update({ status: 'proposed', decided_at: null })
    .eq('user_id', userId)
    .eq('id', id)
    .eq('status', 'approved');
  if (error) console.error(`Could not put spec change ${id} back to proposed: ${error.message}`);
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

/** One hunk of a diff, read for placing against the spec. */
type Hunk = {
  /** What git prints after the second `@@`, usually the section heading. */
  tail: string;
  /** The hunk's lines with their markers, `\ No newline` lines included. */
  lines: string[];
};

/**
 * A diff cut into the lines before its first hunk and the hunks themselves.
 * Null when it names more than one file: a change is to one spec.
 */
function readHunks(diff: string): { head: string[]; hunks: Hunk[] } | null {
  const lines = diff.replace(/\r/g, '').split('\n');
  // A trailing newline is not a blank context line.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const head: string[] = [];
  const hunks: Hunk[] = [];
  let files = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      files++;
      if (files > 1) return null;
      if (hunks.length === 0) head.push(line, lines[i + 1]);
      i++;
    } else if (line.startsWith('@@')) {
      hunks.push({ tail: line.replace(/^@@[^@]*@@/, ''), lines: [] });
    } else if (hunks.length === 0) {
      if (!line.startsWith('diff ') || files === 0) head.push(line);
    } else {
      hunks[hunks.length - 1].lines.push(line);
    }
  }
  return { head, hunks };
}

/** The marker a hunk line carries; an empty line is a blank line of context. */
function markOf(line: string): ' ' | '+' | '-' | '\\' {
  if (line === '') return ' ';
  const first = line[0];
  return first === '+' || first === '-' || first === '\\' ? first : ' ';
}

/** The first place at or after `from` where `want` runs in `have`, ignoring trailing space. */
function findRun(have: readonly string[], want: readonly string[], from: number): number {
  const same = (a: string, b: string) => a.trimEnd() === b.trimEnd();
  for (let at = from; at + want.length <= have.length; at++) {
    if (want.every((line, k) => same(have[at + k], line))) return at;
  }
  return -1;
}

function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

export type RebasedDiff = { ok: true; diff: string } | { ok: false; why: string };

/**
 * A diff placed against the spec as it stands, with its hunk headers written
 * from where its lines actually are.
 *
 * A diff Dash drafts from a comment (plan #1507) gets the lines it changes
 * right far more often than it gets the line numbers right, and #1509 has to
 * apply it. So every hunk's context and removed lines are looked for in the
 * spec, in order, and the `@@ -a,b +c,d @@` header is rewritten from where
 * they were found, with the spec's own text put back on those lines. A hunk
 * whose lines are not in the spec is refused, which is the check that the
 * change still applies. `markdown` is null for a spec the change creates,
 * where every hunk has to be an addition.
 */
export function rebaseDiff(diff: string, markdown: string | null): RebasedDiff {
  const read = readHunks(diff);
  if (!read) return { ok: false, why: 'It changes more than one file, and a change is to one spec.' };
  if (read.hunks.length === 0) return { ok: false, why: 'It has no hunks, so there is nothing to apply.' };

  const spec = markdown === null ? [] : markdown.replace(/\r/g, '').split('\n');
  const out = [...read.head];
  let cursor = 0;
  let offset = 0;

  for (const hunk of read.hunks) {
    const old = hunk.lines.filter((line) => markOf(line) === ' ' || markOf(line) === '-');
    const added = hunk.lines.filter((line) => markOf(line) === '+').length;

    let at: number;
    if (old.length === 0) {
      // An addition with nothing around it can only go at the start of a spec
      // that does not exist yet; anywhere else there is no telling where.
      if (spec.length > 0 && markdown !== null) {
        return { ok: false, why: 'A hunk adds lines without any lines of the spec around them, so there is no telling where they go.' };
      }
      at = 0;
    } else {
      at = findRun(spec, old.map((line) => line.slice(line === '' ? 0 : 1)), cursor);
      if (at < 0) {
        const first = old.find((line) => line.slice(1).trim() !== '') ?? old[0];
        return {
          ok: false,
          why: `Some of the lines it changes are not in the spec as it stands, starting at "${first.slice(1).trim()}".`,
        };
      }
    }

    const oldStart = old.length === 0 ? at : at + 1;
    const newCount = old.length - old.filter((line) => markOf(line) === '-').length + added;
    const newStart = newCount === 0 ? oldStart + offset - 1 : at + 1 + offset;
    out.push(`@@ -${range(oldStart, old.length)} +${range(Math.max(newStart, 0), newCount)} @@${hunk.tail}`);

    // The spec's own wording on every line that was already there.
    let k = at;
    for (const line of hunk.lines) {
      const mark = markOf(line);
      if (mark === ' ' || mark === '-') out.push(`${mark}${spec[k++] ?? ''}`);
      else out.push(line);
    }

    cursor = at + old.length;
    offset += newCount - old.length;
  }

  return { ok: true, diff: out.join('\n') + '\n' };
}

export type AppliedDiff = { ok: true; markdown: string; diff: string } | { ok: false; why: string };

/**
 * The spec with an approved change written into it (plan #1509).
 *
 * Placed first with `rebaseDiff`, so a spec that has moved since the change
 * was drafted still takes it and one whose lines have gone refuses it with
 * the same sentence. The returned `diff` is the placed one, which is what the
 * commit records. `markdown` is null for a spec the change creates.
 */
export function applyDiff(diff: string, markdown: string | null): AppliedDiff {
  const placed = rebaseDiff(diff, markdown);
  if (!placed.ok) return placed;
  const read = readHunks(placed.diff);
  if (!read) return { ok: false, why: 'It changes more than one file, and a change is to one spec.' };

  const spec = markdown === null ? [] : markdown.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of read.hunks) {
    const lines = hunk.lines.filter((line) => markOf(line) !== '\\');
    const oldCount = lines.filter((line) => markOf(line) !== '+').length;
    // rebaseDiff found these lines in order from the cursor, so finding them
    // again from the same cursor lands on the same place.
    const old = lines.filter((line) => markOf(line) !== '+').map((line) => line.slice(line === '' ? 0 : 1));
    const at = oldCount === 0 ? cursor : findRun(spec, old, cursor);
    out.push(...spec.slice(cursor, at));
    for (const line of lines) {
      if (markOf(line) === '+') out.push(line.slice(1));
      else if (markOf(line) === ' ') out.push(line === '' ? '' : line.slice(1));
    }
    cursor = at + oldCount;
  }
  out.push(...spec.slice(cursor));

  const text = out.join('\n');
  return { ok: true, markdown: markdown === null && !text.endsWith('\n') ? `${text}\n` : text, diff: placed.diff };
}

/**
 * The lines of the spec a diff touches or stands beside, trimmed, for finding
 * which sections to hand Dash alongside it. Blank lines are left out, since
 * every section has those.
 */
export function diffAnchorLines(diff: string): string[] {
  return diffLines(diff)
    .filter((line) => line.kind === 'remove' || line.kind === 'context')
    .map((line) => line.text.trim())
    .filter((text) => text !== '');
}

/**
 * The sections of a spec a diff touches: those holding a line it removes or
 * stands beside. Every section when none can be told apart, so a reply still
 * has the spec to read; none when the spec does not exist yet.
 */
export function sectionsTouched(markdown: string | null, diff: string): SpecSection[] {
  if (markdown === null) return [];
  const sections = splitSections(markdown);
  const anchors = diffAnchorLines(diff);
  const touched = sections.filter((section) => anchors.some((line) => section.body.includes(line)));
  return touched.length > 0 ? touched : sections;
}
