import type { SupabaseClient } from '@supabase/supabase-js';
import type { VisionScope } from '@/lib/specs/vision';

/**
 * What the weekly vision review found for each workspace (plan #1104), stored
 * in `vision_reviews` (supabase/migrations/0108).
 *
 * One row per workspace per review. A review either says the vision still
 * holds, with a dated note, or proposes an edit to it with the notes and likes
 * (feedback_items) that argue for it. An edit waits beside the vision as
 * `pending` until the person accepts or dismisses it; accepting writes
 * `module_visions` and the edit's status together, in `decide_vision_edit`.
 *
 * Not `server-only`, like vision.ts: the review procedure writes through a
 * script outside Next, and nothing here does more than query the client it is
 * handed.
 */

export type VisionReviewOutcome = 'holds' | 'edit';
export type VisionEditStatus = 'pending' | 'accepted' | 'dismissed';

/** A note or like cited as evidence, as it reads now. */
export type VisionEvidence = {
  id: string;
  kind: string;
  body: string;
  pagePath: string | null;
  createdAt: string;
};

export type VisionReview = {
  id: string;
  module: VisionScope;
  reviewId: string;
  sessionId: string | null;
  outcome: VisionReviewOutcome;
  /** The vision as the review read it; null when there was none. */
  visionBody: string | null;
  /** The edit's text; null for a 'holds'. */
  proposedBody: string | null;
  note: string;
  evidenceIds: string[];
  /** The rows behind `evidenceIds` that still exist, oldest first. */
  evidence: VisionEvidence[];
  /** Null for a 'holds'. */
  status: VisionEditStatus | null;
  decidedAt: string | null;
  createdAt: string;
};

/** What a review writes for one workspace. */
export type VisionReviewInput = {
  module: VisionScope;
  reviewId: string;
  sessionId?: string | null;
  visionBody: string | null;
  note: string;
} & (
  | { outcome: 'holds' }
  | { outcome: 'edit'; proposedBody: string; evidenceIds: string[] }
);

const COLUMNS =
  'id, module, review_id, session_id, outcome, vision_body, proposed_body, note, evidence_ids, status, decided_at, created_at';

type Row = {
  id: string;
  module: string;
  review_id: string;
  session_id: string | null;
  outcome: VisionReviewOutcome;
  vision_body: string | null;
  proposed_body: string | null;
  note: string;
  evidence_ids: string[] | null;
  status: VisionEditStatus | null;
  decided_at: string | null;
  created_at: string;
};

/** The row a review inserts for one workspace. */
export function visionReviewRow(userId: string, input: VisionReviewInput) {
  const edit = input.outcome === 'edit';
  return {
    user_id: userId,
    module: input.module,
    review_id: input.reviewId,
    session_id: input.sessionId ?? null,
    outcome: input.outcome,
    vision_body: input.visionBody,
    proposed_body: edit ? input.proposedBody : null,
    note: input.note,
    evidence_ids: edit ? input.evidenceIds : [],
    status: edit ? ('pending' as const) : null,
  };
}

/**
 * Record one workspace's finding. An edit for a workspace that already has one
 * pending is refused by the database (one pending edit per workspace), so a
 * review dismisses or supersedes the old one first.
 */
export async function writeVisionReview(
  supabase: SupabaseClient,
  userId: string,
  input: VisionReviewInput,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('vision_reviews')
    .insert(visionReviewRow(userId, input))
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Nothing was written.' };
  return { id: (data as { id: string }).id };
}

/** Attach the evidence rows to each review, dropping ids that no longer exist. */
export function withEvidence(rows: Row[], evidence: VisionEvidence[]): VisionReview[] {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return rows.map((row) => {
    const ids = row.evidence_ids ?? [];
    return {
      id: row.id,
      module: row.module as VisionScope,
      reviewId: row.review_id,
      sessionId: row.session_id,
      outcome: row.outcome,
      visionBody: row.vision_body,
      proposedBody: row.proposed_body,
      note: row.note,
      evidenceIds: ids,
      evidence: ids
        .map((id) => byId.get(id))
        .filter((item): item is VisionEvidence => item !== undefined)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      status: row.status,
      decidedAt: row.decided_at,
      createdAt: row.created_at,
    };
  });
}

async function loadEvidence(
  supabase: SupabaseClient,
  userId: string,
  rows: Row[],
): Promise<VisionEvidence[]> {
  const ids = [...new Set(rows.flatMap((row) => row.evidence_ids ?? []))];
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('feedback_items')
    .select('id, kind, body, page_path, created_at')
    .eq('user_id', userId)
    .in('id', ids);
  return ((data ?? []) as {
    id: string;
    kind: string;
    body: string;
    page_path: string | null;
    created_at: string;
  }[]).map((item) => ({
    id: item.id,
    kind: item.kind,
    body: item.body,
    pagePath: item.page_path,
    createdAt: item.created_at,
  }));
}

/**
 * The latest finding for each workspace, with its evidence: the last dated
 * "still holds", or the edit most recently proposed. What the specs page
 * shows beside each vision.
 */
export async function loadLatestVisionReviews(
  supabase: SupabaseClient,
  userId: string,
): Promise<Partial<Record<VisionScope, VisionReview>>> {
  const { data } = await supabase
    .from('vision_reviews')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const latest = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) {
    if (!latest.has(row.module)) latest.set(row.module, row);
  }
  const rows = [...latest.values()];
  const reviews = withEvidence(rows, await loadEvidence(supabase, userId, rows));

  const byScope: Partial<Record<VisionScope, VisionReview>> = {};
  for (const review of reviews) byScope[review.module] = review;
  return byScope;
}

/** The edits waiting on the person, by workspace, with their evidence. */
export async function loadPendingVisionEdits(
  supabase: SupabaseClient,
  userId: string,
): Promise<Partial<Record<VisionScope, VisionReview>>> {
  const { data } = await supabase
    .from('vision_reviews')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('status', 'pending');

  const rows = (data ?? []) as Row[];
  const reviews = withEvidence(rows, await loadEvidence(supabase, userId, rows));

  const byScope: Partial<Record<VisionScope, VisionReview>> = {};
  for (const review of reviews) byScope[review.module] = review;
  return byScope;
}

/** The edit as `decide_vision_edit` leaves it: which workspace, and both texts. */
export type DecidedVisionEdit = {
  module: VisionScope;
  /** The vision the edit was drafted against; null when there was none. */
  visionBody: string | null;
  proposedBody: string | null;
  status: VisionEditStatus | null;
};

/**
 * Accept or dismiss a pending edit. Accepting replaces the workspace's vision
 * with the proposed text in the same transaction as the status change.
 *
 * Returns the decided edit, so an accept can re-shape the workspace it named
 * (plan #1137). `edit` is null when the function answered with no row.
 */
export async function decideVisionEdit(
  supabase: SupabaseClient,
  editId: string,
  accept: boolean,
): Promise<{ error: string | null; edit: DecidedVisionEdit | null }> {
  const { data, error } = await supabase.rpc('decide_vision_edit', {
    p_edit: editId,
    p_accept: accept,
  });
  if (error) return { error: error.message, edit: null };
  const row = (Array.isArray(data) ? data[0] : data) as Partial<Row> | null | undefined;
  if (!row || typeof row.module !== 'string') return { error: null, edit: null };
  return {
    error: null,
    edit: {
      module: row.module as VisionScope,
      visionBody: row.vision_body ?? null,
      proposedBody: row.proposed_body ?? null,
      status: row.status ?? null,
    },
  };
}
