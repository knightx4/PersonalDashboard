import 'server-only';

import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpend } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { nameCourseTopicsCall, COURSE_TOPICS_MODEL } from './course-band-call';
import {
  CANDIDATES_PER_COURSE,
  bandKey,
  bandLinks,
  frameNames,
  isGraded,
  isGuessed,
  namingText,
  resolveNamedTopics,
  type Candidate,
  type CourseNaming,
} from './course-bands';
import { loadCourseSources } from './course-store';

/**
 * Marking the topics each graded course covered as a band (plan #2172.4.1),
 * as a stage of the daily run after the topic unlocks, and from
 * /api/cron/course-bands by hand to fill a whole transcript at once.
 *
 * 1. Each graded course whose text has changed since it was named, or that
 *    was never named, gets one call (./course-band-call) with the frame
 *    topics nearest its vector (learn.course_topic_candidates, learn 0157).
 *    The reply is kept in learn.course_topics. Without a key, or past the
 *    deadline, the rest wait for the next run.
 * 2. Every naming becomes band links in learn.evidence_links, and band links
 *    no naming makes any more are cleared: a course whose grade stopped
 *    counting, or a topic a renaming dropped.
 *
 * The topic unlock stage (./topics-store) leaves a named course to this one.
 * Runs under the service role, so every query names the person.
 */

const ON_CONFLICT = 'user_id,target_kind,target_id,source_kind,source_id';
const ARTICLE_PAGE = 1000;
/** Calls in flight at once. */
const CONCURRENCY = 4;

export type CourseBandsResult = {
  /** Graded courses on the transcript. */
  graded: number;
  /** Courses named in this run. */
  named: number;
  failed: { courseId: string; detail: string }[];
  /** Graded courses still waiting to be named. */
  remaining: number;
  links: number;
  cleared: number;
};

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function loadNamings(learn: LearnSupabaseClient, userId: string): Promise<(CourseNaming & { text: string })[]> {
  const { data, error } = await learn
    .from('course_topics')
    .select('course_id, depth, guessed, topics, text, named_at')
    .eq('user_id', userId);
  if (error) throw new Error(`Reading the course topics failed: ${error.message}`);
  return (data ?? []) as (CourseNaming & { text: string })[];
}

async function loadFrameNames(learn: LearnSupabaseClient) {
  const rows: { id: string; title: string; aliases: string[] | null }[] = [];
  for (let from = 0; ; from += ARTICLE_PAGE) {
    const { data, error } = await learn
      .from('area_check_articles')
      .select('id, title, aliases')
      .order('id')
      .range(from, from + ARTICLE_PAGE - 1);
    if (error) throw new Error(`Reading the frame topics failed: ${error.message}`);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < ARTICLE_PAGE) break;
  }
  return frameNames(rows);
}

async function loadCandidates(learn: LearnSupabaseClient, userId: string): Promise<Map<string, Candidate[]>> {
  const rpc = learn.rpc.bind(learn) as unknown as Rpc;
  const { data, error } = await rpc('course_topic_candidates', { p_user_id: userId, p_per_course: CANDIDATES_PER_COURSE });
  if (error) throw new Error(`Finding the topics nearest each course failed: ${error.message}`);
  const out = new Map<string, Candidate[]>();
  for (const row of (data ?? []) as { course_id: string; topic_id: string; title: string; level: number; similarity: number }[]) {
    const list = out.get(row.course_id) ?? [];
    list.push({ id: row.topic_id, title: row.title, level: row.level, similarity: row.similarity });
    out.set(row.course_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.similarity - a.similarity);
  return out;
}

export async function refreshCourseBands(
  learn: LearnSupabaseClient,
  userId: string,
  options: { anthropicApiKey?: string; deadline?: number; limit?: number; now?: Date } = {},
): Promise<CourseBandsResult> {
  const now = options.now ?? new Date();
  const nowYear = now.getUTCFullYear();
  const sources = (await loadCourseSources(learn, userId)).filter(isGraded);
  const namings = await loadNamings(learn, userId);
  const stored = new Map(namings.map((n) => [n.course_id, n]));

  const due = sources.filter((c) => stored.get(c.course_id)?.text !== namingText(c));
  const failed: CourseBandsResult['failed'] = [];
  let named = 0;

  if (due.length > 0 && options.anthropicApiKey) {
    const [candidates, names] = await Promise.all([loadCandidates(learn, userId), loadFrameNames(learn)]);
    const core = learn.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;
    const queue = due.slice(0, options.limit ?? due.length);
    const work = async () => {
      for (let course = queue.shift(); course; course = queue.shift()) {
        if (options.deadline && Date.now() >= options.deadline) return;
        const text = namingText(course);
        const shortlist = candidates.get(course.course_id) ?? [];
        const reports: SpendReport[] = [];
        const result = await nameCourseTopicsCall({
          text,
          candidates: shortlist,
          anthropicApiKey: options.anthropicApiKey!,
          onSpend: (r) => reports.push(r),
        });
        for (const report of reports) {
          await recordSpend(core, userId, {
            module: 'learn',
            operation: 'name-course-topics',
            model: report.model,
            usage: report.usage,
          }).catch((e: unknown) => console.error('[learn course bands] spend', e instanceof Error ? e.message : e));
        }
        if (!result.ok) {
          failed.push({ courseId: course.course_id, detail: result.detail });
          continue;
        }
        const guessed = isGuessed(course);
        const topics = resolveNamedTopics(result.reply, shortlist, names, guessed);
        const row = {
          course_id: course.course_id,
          user_id: userId,
          depth: result.reply.depth,
          guessed,
          topics,
          text,
          model: COURSE_TOPICS_MODEL,
          named_at: now.toISOString(),
        };
        const { error } = await learn.from('course_topics').upsert(row, { onConflict: 'course_id' });
        if (error) {
          failed.push({ courseId: course.course_id, detail: error.message });
          continue;
        }
        stored.set(course.course_id, { ...row });
        named += 1;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
  }

  // 2. The links every naming makes, and clearing the ones none does.
  const rows = bandLinks([...stored.values()], sources, nowYear).map((r) => ({ ...r, user_id: userId }));
  if (rows.length > 0) {
    const { error } = await learn.from('evidence_links').upsert(rows, { onConflict: ON_CONFLICT });
    if (error) throw new Error(`Writing the course bands failed: ${error.message}`);
  }
  const { data: existing, error: readError } = await learn
    .from('evidence_links')
    .select('id, target_id, source_id')
    .eq('user_id', userId)
    .eq('target_kind', 'topic')
    .eq('source_kind', 'course')
    .not('band_high', 'is', null);
  if (readError) throw new Error(`Reading the course bands failed: ${readError.message}`);
  const keep = new Set(rows.map(bandKey));
  const stale = ((existing ?? []) as { id: string; target_id: string; source_id: string }[])
    .filter((r) => !keep.has(bandKey(r)))
    .map((r) => r.id);
  if (stale.length > 0) {
    const { error } = await learn.from('evidence_links').delete().eq('user_id', userId).in('id', stale);
    if (error) throw new Error(`Clearing old course bands failed: ${error.message}`);
  }

  const remaining = sources.filter((c) => stored.get(c.course_id)?.text !== namingText(c)).length;
  return { graded: sources.length, named, failed, remaining, links: rows.length, cleared: stale.length };
}
