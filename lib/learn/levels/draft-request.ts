import { z } from 'zod';
import { NO_SOURCES, readDraftedFromBrief, type DraftSources, type DraftedFromBrief } from '@/lib/learn/levels/draft-sources';
import type { CanonText, StoredSourceRef } from '@/lib/learn/levels/stored-sources';

/**
 * A topic waiting for the routine to draft it (learn 0193): what the drafting
 * prompt is given besides the map, and what is done with the draft once it is
 * kept. Pure, so the press that queues it, the script that saves it and the
 * tests read and write the same shapes.
 */

export type DraftRequestInput = {
  scope: string | null;
  sources: DraftSources;
  documents: StoredSourceRef[];
  canon: CanonText[];
  brief: DraftedFromBrief | null;
};

/**
 * What the press did with a draft once it was kept, done instead by the
 * script that saves the routine's draft. Every part is optional.
 */
export type DraftAfter = {
  /** Approve it as kept (plan #2356.2), uncited rows marked personal. */
  approve?: boolean;
  /** Add it to this subject's lens (a goal named on a subject's page). */
  subjectLens?: string;
  /** The topic whose wanted list named this one: settle it (a wanted topic drafted from a draft's page). */
  wanted?: { topicId: string; name: string };
  /** The Level 4 frame topic it refines (a territory's topic). */
  refinesArticleId?: string;
  /** Its target on a lens (a territory's topic), capped at its ceiling. */
  lensTarget?: { lensId: string; target: number };
};

export type DraftRequestStatus = 'queued' | 'drafting' | 'done' | 'failed';

export type DraftRequest = {
  id: string;
  userId: string;
  goal: string;
  input: DraftRequestInput;
  after: DraftAfter;
  preparationId: string | null;
  status: DraftRequestStatus;
};

export const DRAFT_REQUEST_COLUMNS = 'id, user_id, goal, input, after_draft, preparation_id, status';

/**
 * How long a taken request may sit drafting before it is taken as dead. A
 * draft takes the session a few minutes; one silent for an hour stopped
 * without saving, and is handed out again.
 */
export const DRAFTING_STALE_MS = 60 * 60 * 1000;

const id = z.string().uuid();

const afterSchema = z.object({
  approve: z.boolean().optional(),
  subjectLens: id.optional(),
  wanted: z.object({ topicId: id, name: z.string().min(1) }).optional(),
  refinesArticleId: id.optional(),
  lensTarget: z.object({ lensId: id, target: z.number().int().min(1).max(10) }).optional(),
});

/** `after_draft` as read back; parts that do not parse are dropped, never guessed. */
export function readDraftAfter(value: unknown): DraftAfter {
  if (!value || typeof value !== 'object') return {};
  const out: DraftAfter = {};
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(afterSchema.shape) as (keyof DraftAfter)[]) {
    const one = afterSchema.shape[key].safeParse(raw[key]);
    if (one.success && one.data !== undefined) Object.assign(out, { [key]: one.data });
  }
  return out;
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** `input` as read back. Sources were written by the press from checked values, so only the shape is checked here. */
export function readDraftRequestInput(value: unknown): DraftRequestInput {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const sources = raw.sources && typeof raw.sources === 'object' ? (raw.sources as Partial<DraftSources>) : null;
  return {
    scope: typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope : null,
    sources: sources
      ? { sources: arrayOf(sources.sources), performances: arrayOf<string>(sources.performances).filter((p) => typeof p === 'string') }
      : NO_SOURCES,
    documents: arrayOf<StoredSourceRef>(raw.documents),
    canon: arrayOf<CanonText>(raw.canon),
    brief: readDraftedFromBrief(raw.brief),
  };
}

/** A request row as read back. */
export function readDraftRequest(row: Record<string, unknown>): DraftRequest {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    goal: String(row.goal),
    input: readDraftRequestInput(row.input),
    after: readDraftAfter(row.after_draft),
    preparationId: typeof row.preparation_id === 'string' ? row.preparation_id : null,
    status: row.status as DraftRequestStatus,
  };
}

/** The first line of the brief the routine is fired with; the skill reads the queue itself. */
export const DRAFT_SKILL_LINE = 'Follow .claude/skills/learn-drafts/SKILL.md';

/** The brief the goals routine is fired with: the skill, and whose queue to work. */
export function draftRoutineBrief(userId: string, waiting: number): string {
  return [DRAFT_SKILL_LINE, `Learn topic drafts`, `user_id ${userId}`, `waiting ${waiting}`].join('\n');
}
