import type { NoteCounts } from '@/lib/learn/graph/from-note';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What each reading of a note found, and whether the person took it (plan
 * #1721). One row per reading, written when the concepts are proposed and
 * marked when they are approved. A row never marked is a reading whose
 * concepts were left alone, which is all that turning them down looks like:
 * the approval form has no separate reject.
 */

/** Write the row for a reading and return its id, or null when it cannot be kept. */
export async function recordNoteRead(
  supabase: LearnSupabaseClient,
  userId: string,
  input: { readingId: string; subjectId: string; counts: NoteCounts },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('note_reads')
    .insert({
      user_id: userId,
      reading_id: input.readingId,
      subject_id: input.subjectId,
      proposed: input.counts.proposed,
      kept: input.counts.kept,
      weak: input.counts.weak,
      dropped: input.counts.dropped,
    })
    .select('id')
    .single();

  assertSchemaExposed(error, LEARN_SCHEMA);
  // The counts are a report. Failing to keep one must not fail the reading.
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** Mark a reading approved, with how many new concepts that added. */
export async function markNoteReadApproved(
  supabase: LearnSupabaseClient,
  noteReadId: string,
  approvedCount: number,
): Promise<void> {
  const { error } = await supabase
    .from('note_reads')
    .update({ approved_at: new Date().toISOString(), approved_count: approvedCount })
    .eq('id', noteReadId)
    .is('approved_at', null);
  assertSchemaExposed(error, LEARN_SCHEMA);
}

export type NoteReadRow = {
  proposed: number;
  kept: number;
  weak: number;
  approved_at: string | null;
  approved_count: number | null;
};

export type NoteReadSummary = {
  reads: number;
  /** Concepts shown to be approved: kept plus weak. */
  shown: number;
  approved: number;
  /** Readings that put nothing in front of the person. */
  empty: number;
  /** Concepts shown per reading. */
  perNote: number;
  /** Approved over shown, or null when nothing was shown. */
  approvedShare: number | null;
  /** Concepts the extraction returned per reading, before the check. */
  proposedPerNote: number;
};

/** The numbers the report prints for a set of readings. */
export function summariseNoteReads(rows: readonly NoteReadRow[]): NoteReadSummary {
  const reads = rows.length;
  const shown = rows.reduce((sum, r) => sum + r.kept + r.weak, 0);
  const proposed = rows.reduce((sum, r) => sum + r.proposed, 0);
  const approved = rows.reduce((sum, r) => sum + (r.approved_count ?? 0), 0);
  return {
    reads,
    shown,
    approved,
    empty: rows.filter((r) => r.kept + r.weak === 0).length,
    perNote: reads === 0 ? 0 : shown / reads,
    approvedShare: shown === 0 ? null : approved / shown,
    proposedPerNote: reads === 0 ? 0 : proposed / reads,
  };
}
