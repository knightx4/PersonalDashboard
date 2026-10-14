import 'server-only';

import {
  runEmbedSweep,
  vectorLiteral,
  type EmbedSweepOptions,
  type EmbedSweepResult,
  type SegmentStore,
} from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { ledgerIdeaSpend } from '@/lib/learn/embed/idea-embedding';
import { DEFAULT_EMBEDDING_MODEL, type EmbeddingModel } from '@/lib/learn/embed/voyage';
import {
  COURSE_MIN_SIMILARITY,
  COURSE_TITLE_ONLY_MIN_SIMILARITY,
  courseLinks,
  courseText,
  isTitleOnly,
  type CourseMatch,
  type CourseSource,
} from './courses';

/**
 * Linking ideas to the courses you have taken (plan #2006.4), as a stage of
 * the daily run after the places and the dust.
 *
 * Two halves. First each course on a transcript gets a text, from its title,
 * a catalogue description and its notes (learn.course_sources, migration
 * learn 0123), and a vector for that text in learn.course_embeddings; a
 * course whose text has not changed since it was embedded costs nothing.
 * Then the database compares every course with every idea
 * (learn.course_idea_matches), a course with notes by the closest of its own
 * vector and its notes' passages, and the matches become rows of
 * learn.evidence_links, weighted by grade and age (./courses). A course link
 * not found again in this pass is cleared, so a course whose grade turns out
 * to be waived, or an idea reworded away from it, loses its link.
 *
 * Writes go through the service role: evidence_links has no insert policy.
 */

const PER_COURSE = 30;
const PER_IDEA = 5;
const WRITE_BATCH = 200;
/** Course texts run to many thousands of characters, so a few per call. */
const EMBED_CHUNK = 8;

export type LinkCoursesResult = {
  /** What embedding the course texts did, or null with no embedding key. */
  embedded: EmbedSweepResult | null;
  courses: number;
  links: number;
  cleared: number;
};

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function rpc(learn: LearnSupabaseClient): Rpc {
  return learn.rpc.bind(learn) as unknown as Rpc;
}

export async function loadCourseSources(
  learn: LearnSupabaseClient,
  userId: string,
): Promise<CourseSource[]> {
  const { data, error } = await rpc(learn)('course_sources', { p_user_id: userId });
  if (error) throw new Error(`Reading courses failed: ${error.message}`);
  return (data ?? []) as CourseSource[];
}

type StoredCourse = {
  course_id: string;
  text: string;
  embedding_model: string | null;
  embedded: boolean;
};

/**
 * A store over learn.course_embeddings. The courses due are those whose text
 * is new or changed or whose vector a different model made; they are worked
 * out once from what was read, and handed out a chunk at a time.
 */
export function courseStore(
  learn: LearnSupabaseClient,
  userId: string,
  due: { id: string; text: string; titleOnly: boolean }[],
): SegmentStore {
  const queue = [...due];
  const titleOnly = new Map(due.map((course) => [course.id, course.titleOnly]));
  return {
    async unembedded(limit) {
      return queue.splice(0, limit).map(({ id, text }) => ({ id, text }));
    },
    async store(rows) {
      if (rows.length === 0) return 0;
      const { data, error } = await learn
        .from('course_embeddings')
        .upsert(
          rows.map((row) => ({
            course_id: row.id,
            user_id: userId,
            text: row.text,
            title_only: titleOnly.get(row.id) ?? false,
            embedding: vectorLiteral(row.vector),
            embedding_model: row.model,
            embedded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'course_id' },
        )
        .select('course_id');
      if (error) throw new Error(`Storing a course's embedding failed: ${error.message}`);
      return (data ?? []).length;
    },
  };
}

/** The courses whose text or model differs from what is stored. */
export function coursesDue(
  sources: CourseSource[],
  stored: StoredCourse[],
  model: EmbeddingModel,
): { id: string; text: string; titleOnly: boolean }[] {
  const byId = new Map(stored.map((row) => [row.course_id, row]));
  const due: { id: string; text: string; titleOnly: boolean }[] = [];
  for (const course of sources) {
    const text = courseText(course);
    const current = byId.get(course.course_id);
    if (current && current.embedded && current.text === text && current.embedding_model === model)
      continue;
    due.push({ id: course.course_id, text, titleOnly: isTitleOnly(course) });
  }
  return due;
}

async function loadStored(learn: LearnSupabaseClient, userId: string): Promise<StoredCourse[]> {
  const { data, error } = await learn
    .from('course_embeddings')
    .select('course_id, text, embedding_model, embedded_at')
    .eq('user_id', userId);
  if (error) throw new Error(`Reading course embeddings failed: ${error.message}`);
  return (
    (data ?? []) as {
      course_id: string;
      text: string;
      embedding_model: string | null;
      embedded_at: string | null;
    }[]
  ).map((row) => ({
    course_id: row.course_id,
    text: row.text,
    embedding_model: row.embedding_model,
    embedded: row.embedded_at !== null,
  }));
}

/**
 * Embed what is due, then link. `embed` false skips the embedding half, for a
 * run with no embedding key: the links are still refreshed from the vectors
 * already stored.
 */
export async function linkCourses(
  learn: LearnSupabaseClient,
  userId: string,
  options: EmbedSweepOptions & { embed?: boolean; nowYear?: number } = {},
): Promise<LinkCoursesResult> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const nowYear = options.nowYear ?? new Date().getUTCFullYear();
  const sources = await loadCourseSources(learn, userId);
  if (sources.length === 0) return { embedded: null, courses: 0, links: 0, cleared: 0 };

  let embedded: EmbedSweepResult | null = null;
  if (options.embed !== false) {
    const due = coursesDue(sources, await loadStored(learn, userId), model);
    if (due.length > 0) {
      embedded = await runEmbedSweep(
        {
          store: courseStore(learn, userId, due),
          embed: ({ texts, model: asked, onSpend }) =>
            embedTexts({ texts, model: asked, inputType: 'document', onSpend }),
          ledger: (report) => ledgerIdeaSpend(learn, userId, [report]),
        },
        { ...options, model, chunk: options.chunk ?? EMBED_CHUNK },
      );
    }
  }

  const { data, error } = await rpc(learn)('course_idea_matches', {
    p_user_id: userId,
    p_min_similarity: COURSE_MIN_SIMILARITY,
    p_min_similarity_title_only: COURSE_TITLE_ONLY_MIN_SIMILARITY,
    p_per_course: PER_COURSE,
    p_per_idea: PER_IDEA,
  });
  if (error) throw new Error(`Matching courses to ideas failed: ${error.message}`);
  const rows = courseLinks((data ?? []) as CourseMatch[], sources, nowYear);

  const runStarted = new Date().toISOString();
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const batch = rows.slice(i, i + WRITE_BATCH).map((row) => ({
      ...row,
      user_id: userId,
      found_at: runStarted,
    }));
    const { error: writeError } = await learn
      .from('evidence_links')
      .upsert(batch, { onConflict: 'user_id,target_kind,target_id,source_kind,source_id' });
    if (writeError) throw new Error(`Writing course evidence failed: ${writeError.message}`);
  }

  // Course links this pass did not find again: the match fell below the
  // threshold, the grade stopped counting, or the course went.
  const { data: cleared, error: clearError } = await learn
    .from('evidence_links')
    .delete()
    .eq('user_id', userId)
    .eq('source_kind', 'course')
    .lt('found_at', runStarted)
    .select('id');
  if (clearError) throw new Error(`Clearing old course evidence failed: ${clearError.message}`);

  return { embedded, courses: sources.length, links: rows.length, cleared: (cleared ?? []).length };
}
