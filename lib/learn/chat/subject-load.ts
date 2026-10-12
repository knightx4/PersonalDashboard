import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * What a subject's page shows of the readings related to it and the
 * conversations logged about it (plan #1814). Read on the person's session,
 * so RLS scopes both.
 */

export type SubjectReading = {
  id: string;
  title: string;
  status: 'queued' | 'reading' | 'read' | 'abandoned';
  why: string | null;
  /** True while where to read it is still being looked up. */
  pending: boolean;
};

export type SubjectSession = {
  id: string;
  topic: string;
  summary: string;
  ideas: string[];
  createdAt: string;
};

export type SubjectLearning = { readings: SubjectReading[]; sessions: SubjectSession[] };

const STATUS_ORDER: Record<SubjectReading['status'], number> = { reading: 0, queued: 1, read: 2, abandoned: 3 };

export async function loadSubjectLearning(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<SubjectLearning> {
  const [links, log] = await Promise.all([
    supabase
      .from('reading_subjects')
      .select('readings!inner(id, title, status, why, find_after, sources!readings_source_fk(title))')
      .eq('subject_id', subjectId)
      .limit(200),
    supabase
      .from('learning_log')
      .select('id, topic, summary, ideas, created_at')
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  if (links.error) throw new Error(`Reading the subject's readings failed: ${links.error.message}`);
  if (log.error) throw new Error(`Reading the subject's conversations failed: ${log.error.message}`);

  type Joined = {
    id: string;
    title: string | null;
    status: SubjectReading['status'];
    why: string | null;
    find_after: string | null;
    sources: { title: string } | { title: string }[] | null;
  };
  const readings = ((links.data ?? []) as unknown as { readings: Joined | Joined[] }[])
    .flatMap((row) => (Array.isArray(row.readings) ? row.readings : [row.readings]))
    .map((row): SubjectReading => {
      const source = Array.isArray(row.sources) ? row.sources[0] : row.sources;
      return {
        id: row.id,
        title: row.title ?? source?.title ?? 'Untitled',
        status: row.status,
        why: row.why,
        pending: row.find_after !== null,
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const sessions = ((log.data ?? []) as {
    id: string;
    topic: string;
    summary: string;
    ideas: { name?: unknown }[] | null;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    ideas: (row.ideas ?? []).flatMap((idea) => (typeof idea?.name === 'string' ? [idea.name] : [])),
    createdAt: row.created_at,
  }));

  return { readings, sessions };
}
