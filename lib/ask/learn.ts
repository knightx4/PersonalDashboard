import { optionalString, AskInputError, type AskContext, type AskRow, type AskToolResult, type SchemaClient } from './db';

/**
 * reading_list and learning_covered (plan #1813, under #1805): what is on the
 * person's Learn reading list, and what they have covered on a topic.
 *
 * Both read the learn schema on the caller's client, the person's session in
 * Ask and the read-only token through the connector, and filter by their id
 * as well as RLS. A subject is found by the words of its name; a reading
 * belongs to it through learn.reading_subjects (plan #1807) or by sitting on
 * a list whose title holds the same words.
 *
 * learning_covered reports exposure and tested state side by side and never
 * merges them: a session logged from a chat says the ideas were met, and only
 * a concept's state says whether they are known (KNOWLEDGE-SPEC, "Everything
 * starts unknown").
 */

/** The most rows either lookup lists. */
export const LEARN_ROWS = 60;

const STATUSES = ['queued', 'reading', 'read', 'abandoned'] as const;
type Status = (typeof STATUSES)[number];

/** Knowledge states that count as known in the summary. */
const KNOWN = new Set(['recognised', 'known', 'sharp']);

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function hasAll(text: string, wanted: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return wanted.every((word) => lower.includes(word));
}

type SubjectRow = { id: string; name: string };

/** The person's subjects whose name holds every word given. */
async function subjectsNamed(learn: SchemaClient, userId: string, phrase: string): Promise<SubjectRow[]> {
  const wanted = words(phrase);
  if (wanted.length === 0) return [];
  const { data, error } = await learn.from('subjects').select('id, name').eq('user_id', userId).limit(2000);
  if (error) throw new Error(`subjects: ${error.message}`);
  return ((data ?? []) as SubjectRow[]).filter((row) => hasAll(row.name, wanted));
}

function statusOf(input: Record<string, unknown>): Status | 'open' | null {
  const value = optionalString(input, 'status');
  if (!value) return null;
  if (value === 'open' || (STATUSES as readonly string[]).includes(value)) return value as Status | 'open';
  throw new AskInputError('status must be open, queued, reading, read or abandoned.');
}

type ReadingRow = {
  id: string;
  title: string | null;
  why: string | null;
  note: string | null;
  status: Status;
  open_url: string | null;
  find_after: string | null;
  track_id: string;
  finished_at: string | null;
  sources: { title: string; author: string | null } | { title: string; author: string | null }[] | null;
  tracks: { title: string } | { title: string }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function readingListLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const subject = optionalString(input, 'subject');
  const query = optionalString(input, 'query');
  const status = statusOf(input);
  const learn = await ctx.db('learn');

  const { data, error } = await learn
    .from('readings')
    .select(
      'id, title, why, note, status, open_url, find_after, track_id, finished_at, sources!readings_source_fk(title, author), tracks!readings_track_fk(title)',
    )
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw new Error(`readings: ${error.message}`);
  let rows = (data ?? []) as unknown as ReadingRow[];
  const saved = rows.length;

  let subjects: SubjectRow[] = [];
  if (subject) {
    subjects = await subjectsNamed(learn, ctx.userId, subject);
    const related = new Set<string>();
    if (subjects.length > 0) {
      const { data: links, error: linkError } = await learn
        .from('reading_subjects')
        .select('reading_id')
        .eq('user_id', ctx.userId)
        .in('subject_id', subjects.map((row) => row.id));
      if (linkError) throw new Error(`reading_subjects: ${linkError.message}`);
      for (const link of (links ?? []) as { reading_id: string }[]) related.add(link.reading_id);
    }
    const wanted = words(subject);
    rows = rows.filter((row) => related.has(row.id) || hasAll(one(row.tracks)?.title ?? '', wanted));
  }
  if (query) {
    const wanted = words(query);
    rows = rows.filter((row) => {
      const source = one(row.sources);
      return hasAll(`${row.title ?? ''} ${source?.title ?? ''} ${source?.author ?? ''} ${row.why ?? ''}`, wanted);
    });
  }
  if (status === 'open') rows = rows.filter((row) => row.status === 'queued' || row.status === 'reading');
  else if (status) rows = rows.filter((row) => row.status === status);

  const note =
    saved === 0
      ? 'The reading list is empty.'
      : subject && subjects.length === 0 && rows.length === 0
        ? `No subject is named like "${subject}", and no list title holds those words. Call learning_covered or leave subject out.`
        : rows.length === 0
          ? 'Nothing on the reading list matched.'
          : rows.length > LEARN_ROWS
            ? `${rows.length} matched; the newest ${LEARN_ROWS} are listed.`
            : undefined;

  return {
    ok: true,
    rows: rows.slice(0, LEARN_ROWS).map((row): AskRow => {
      const source = one(row.sources);
      return {
        table: 'learn.readings',
        ref: row.id,
        title: row.title ?? source?.title ?? 'Untitled',
        href: `/learn/r/${row.id}`,
        detail: {
          status: row.status,
          list: one(row.tracks)?.title ?? null,
          author: source?.author ?? null,
          why: row.why,
          note: row.note,
          link: row.open_url,
          link_pending: row.find_after !== null,
          finished: row.finished_at?.slice(0, 10) ?? null,
        },
      };
    }),
    totals: { matched: rows.length, saved, subjects_matched: subjects.length },
    ...(note ? { note } : {}),
  };
}

type LogRow = {
  id: string;
  subject_id: string | null;
  topic: string;
  question: string | null;
  summary: string;
  ideas: { name: string }[];
  created_at: string;
};

export async function learningCoveredLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const topic = optionalString(input, 'topic');
  if (!topic) throw new AskInputError('topic is required: the words of the subject or topic to look up.');
  const wanted = words(topic);
  const learn = await ctx.db('learn');

  const subjects = await subjectsNamed(learn, ctx.userId, topic);
  const subjectIds = subjects.map((row) => row.id);

  const { data: logData, error: logError } = await learn
    .from('learning_log')
    .select('id, subject_id, topic, question, summary, ideas, created_at')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (logError) throw new Error(`learning_log: ${logError.message}`);
  const sessions = ((logData ?? []) as LogRow[]).filter(
    (row) =>
      (row.subject_id !== null && subjectIds.includes(row.subject_id)) ||
      hasAll(`${row.topic} ${row.question ?? ''} ${row.summary}`, wanted),
  );

  const subjectRows: AskRow[] = [];
  for (const subject of subjects.slice(0, 10)) {
    const { data: concepts, error } = await learn
      .from('concepts')
      .select('id')
      .eq('user_id', ctx.userId)
      .eq('subject_id', subject.id)
      .limit(2000);
    if (error) throw new Error(`concepts: ${error.message}`);
    const conceptIds = ((concepts ?? []) as { id: string }[]).map((row) => row.id);
    const tested = new Map<string, string>();
    for (let i = 0; i < conceptIds.length; i += 200) {
      const { data: stateRows, error: stateError } = await learn
        .from('concept_state')
        .select('concept_id, state')
        .eq('user_id', ctx.userId)
        .in('concept_id', conceptIds.slice(i, i + 200));
      if (stateError) throw new Error(`concept_state: ${stateError.message}`);
      for (const row of (stateRows ?? []) as { concept_id: string; state: string }[]) tested.set(row.concept_id, row.state);
    }
    const states = conceptIds.map((id) => tested.get(id) ?? 'unknown');
    const { count: read } = await learn
      .from('reading_subjects')
      .select('reading_id, readings!inner(status)', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('subject_id', subject.id)
      .eq('readings.status', 'read');
    subjectRows.push({
      table: 'learn.subjects',
      ref: subject.id,
      title: subject.name,
      href: `/learn/s/${subject.id}`,
      detail: {
        ideas: states.length,
        ideas_known: states.filter((state) => KNOWN.has(state)).length,
        ideas_untested: states.filter((state) => state === 'unknown').length,
        misconceptions: states.filter((state) => state === 'misconception').length,
        readings_read: read ?? 0,
      },
    });
  }

  const sessionRows = sessions.slice(0, LEARN_ROWS - subjectRows.length).map(
    (row): AskRow => ({
      table: 'learn.learning_log',
      ref: row.id,
      title: row.topic,
      href: row.subject_id ? `/learn/s/${row.subject_id}` : '/learn',
      detail: {
        date: row.created_at.slice(0, 10),
        question: row.question,
        summary: row.summary,
        ideas: (row.ideas ?? []).map((idea) => idea.name).join('; ') || null,
      },
    }),
  );

  const note =
    subjectRows.length === 0 && sessionRows.length === 0
      ? `Nothing in Learn is named like "${topic}", and no logged session mentions it.`
      : 'Sessions are what a conversation covered; they credit nothing. ideas_known counts only what the person was tested on.';

  return {
    ok: true,
    rows: [...subjectRows, ...sessionRows],
    totals: { subjects: subjects.length, sessions: sessions.length },
    note,
  };
}
