/**
 * Writing friction and lessons (migration 0303). The rules are in
 * ./friction.ts; this file only reads and writes, through whatever tagged
 * template the caller holds (postgres, or httpsSql in a cloud session).
 *
 * Every write here names the account it was given. The tools pass the plan's
 * owner, so no other account's rows are touched.
 */
import {
  briefLessons,
  clip,
  isLessonKey,
  lessonsBlock,
  rankLessons,
  type FrictionKind,
  type FrictionRow,
  type LessonRow,
} from './friction';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

export type NewFriction = {
  kind: FrictionKind;
  what: string;
  lesson?: { key: string; title: string } | null;
  cost?: number | null;
  planItemId?: string | null;
  runId?: string | null;
  source?: 'session' | 'tool' | 'review';
};

export type Recorded = {
  id: string;
  lessonKey: string | null;
  /** The lesson was fixed and this friction shows it back: reopened. */
  regressed: boolean;
  /** How many times this lesson has been hit in the last 14 days, this one included. */
  recent: number;
  /** What builders were told to do about it, when anything. */
  lesson: string | null;
};

/** The lesson under this key, made when it does not exist. */
export async function ensureLesson(
  sql: Sql,
  userId: string,
  key: string,
  title: string,
): Promise<LessonRow> {
  if (!isLessonKey(key)) throw new Error(`"${key}" is not a lesson key: lower case words joined by hyphens.`);
  const [row] = await sql`
    insert into build_lessons (user_id, key, title)
    values (${userId}, ${key}, ${clip(title, 200)})
    on conflict (user_id, key) do update set updated_at = build_lessons.updated_at
    returning id, key, title, lesson, status, fix, fixed_at, regressed_at`;
  return row as LessonRow;
}

/**
 * One friction row, filed under its lesson when one is given. A fixed lesson
 * that is hit again goes back to open with its regression dated, so the next
 * review takes it first.
 */
export async function recordFriction(sql: Sql, userId: string, input: NewFriction): Promise<Recorded> {
  let lesson: LessonRow | null = null;
  if (input.lesson) lesson = await ensureLesson(sql, userId, input.lesson.key, input.lesson.title);
  const [row] = await sql`
    insert into build_friction (user_id, lesson_id, plan_item_id, run_id, kind, what, cost_minutes, source)
    values (${userId}, ${lesson?.id ?? null}, ${input.planItemId ?? null}, ${input.runId ?? null},
            ${input.kind}, ${clip(input.what)}, ${input.cost ?? null}, ${input.source ?? 'session'})
    returning id`;
  let regressed = false;
  let recent = 1;
  if (lesson) {
    if (lesson.status === 'fixed') {
      await sql`
        update build_lessons set status = 'open', regressed_at = now(), updated_at = now()
        where id = ${lesson.id} and user_id = ${userId}`;
      regressed = true;
    }
    const [count] = await sql`
      select count(*)::int as n from build_friction
      where user_id = ${userId} and lesson_id = ${lesson.id} and created_at > now() - interval '14 days'`;
    recent = (count?.n as number) ?? 1;
  }
  return { id: row.id as string, lessonKey: lesson?.key ?? null, regressed, recent, lesson: lesson?.lesson ?? null };
}

/**
 * The same, for a tool recording its own refusal: it never throws, since a
 * refusal must still be printed when the table is not there or the write
 * fails, and it says nothing unless the lesson has a word for the builder.
 */
export async function recordToolFriction(
  sql: Sql,
  userId: string,
  input: Omit<NewFriction, 'source'>,
): Promise<string | null> {
  try {
    const recorded = await recordFriction(sql, userId, { ...input, source: 'tool' });
    const parts: string[] = [];
    if (recorded.recent > 1) parts.push(`Builders have hit this ${recorded.recent} times in 14 days (lesson ${recorded.lessonKey}).`);
    if (recorded.regressed) parts.push('It was marked fixed and has come back: the next builder review takes it first.');
    if (recorded.lesson) parts.push(`What to do: ${recorded.lesson}`);
    return parts.length > 0 ? parts.join(' ') : null;
  } catch {
    return null;
  }
}

/** Every lesson and the last 28 days of friction, ranked (./friction.ts). */
export async function loadRanked(sql: Sql, userId: string, now = Date.now()) {
  const lessons = (await sql`
    select id, key, title, lesson, status, fix, fixed_at, regressed_at
    from build_lessons where user_id = ${userId}`) as LessonRow[];
  const friction = (await sql`
    select lesson_id, kind, cost_minutes, created_at from build_friction
    where user_id = ${userId} and created_at > now() - interval '28 days'`) as FrictionRow[];
  return rankLessons(lessons, friction, now);
}

/** The block printed when a builder claims a step; empty when there is nothing to say or no table. */
export async function lessonsForBuilder(sql: Sql, userId: string): Promise<string> {
  try {
    return lessonsBlock(briefLessons(await loadRanked(sql, userId)));
  } catch {
    return '';
  }
}
