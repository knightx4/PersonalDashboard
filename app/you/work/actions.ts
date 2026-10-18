'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { answerCourseExplain } from '@/lib/learn/evidence/course-explain-store';
import type { TopicResult } from '@/lib/learn/evidence/course-explain';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createYouClient } from '@/lib/you/auth/server';
import {
  EDUCATION_HREF,
  isTranscriptSize,
  ownsTranscriptPath,
  parseCourse,
  parseCourseRows,
  parseRowList,
  schoolField,
  transcriptContentType,
} from '@/lib/you/education';
import { createCoreClient } from '@/lib/core/auth/server';
import { recordSpendReports } from '@/lib/core/spend/record';
import { readCourseFile, type CourseFileRead } from '@/lib/you/course-file-read';
import { askCourseFileModel, COURSE_FILE_MODEL, COURSE_FILE_OPERATION } from '@/lib/you/course-file-model';
import { askTranscriptModel, TRANSCRIPT_OPERATION } from '@/lib/you/transcript-model';
import { readTranscript, type DraftCourse } from '@/lib/you/transcript-read';
import {
  courseFileContentType,
  courseFileTitle,
  ownsCourseFilePath,
  parseKind,
  parseWeek,
} from '@/lib/you/course-files';
import {
  COURSE_FILES_BUCKET,
  COURSE_FILES_MAX,
  COURSE_FILE_MAX_BYTES,
  deleteCourse,
  deleteCourseFile,
  deleteTranscript,
  TRANSCRIPTS_BUCKET,
  type CourseFile,
  type TranscriptStore,
} from '@/lib/you/transcripts';

/**
 * The Work & school tab's actions (plan #1308, under #1304).
 *
 * Adding a transcript is two presses with you between them, as the goals
 * document reader is. The browser uploads the file (or the pasted text, as a
 * .txt file) straight into your folder of the vault-transcripts bucket, which
 * keeps the file out of these requests. `readTranscriptAction` reads it and
 * saves nothing; `saveTranscriptAction` writes the transcript and the courses
 * you checked. `discardUploadAction` removes a file you read and then did not
 * keep.
 *
 * Everything runs on the session client, so RLS and the bucket's policies
 * (supabase/migrations-vault/0030_transcripts.sql) decide what is yours; the
 * path checks below only stop a request reaching storage for a path that could
 * not be.
 */

export type TranscriptDraft = {
  path: string;
  fileName: string;
  sizeBytes: number;
  school: string | null;
  courses: DraftCourse[];
};

export type ReadTranscriptState = { error?: string; draft?: TranscriptDraft };

const ReadInput = z.object({
  path: z.string().min(1).max(400),
  fileName: z.string().trim().min(1).max(255),
});

/** Read the courses off a file already uploaded to your folder. Saves nothing. */
// latency: pending
export async function readTranscriptAction(raw: { path: string; fileName: string }): Promise<ReadTranscriptState> {
  const user = await requireUser();
  const parsed = ReadInput.safeParse(raw);
  if (!parsed.success || !ownsTranscriptPath(user.id, parsed.data.path)) {
    return { error: 'That file could not be found. Try uploading it again.' };
  }
  const { path, fileName } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot read transcripts.' };

  const you = await createYouClient();
  const { data, error } = await you.storage.from(TRANSCRIPTS_BUCKET).download(path);
  if (error || !data) return { error: 'That file could not be opened. Try uploading it again.' };
  const bytes = new Uint8Array(await data.arrayBuffer());

  const spend = collectSpend();
  let read;
  try {
    read = await readTranscript({ name: path, bytes }, (source) =>
      askTranscriptModel({ apiKey, onSpend: spend.sink }, source),
    );
  } catch {
    read = { ok: false as const, error: 'That transcript could not be read. Try again.' };
  }
  await recordLearnSpend(user.id, TRANSCRIPT_OPERATION, spend.reports);

  if (!read.ok) {
    // Nothing points at the file yet, and nothing will: you upload again to retry.
    await you.storage.from(TRANSCRIPTS_BUCKET).remove([path]);
    return { error: read.error };
  }
  return {
    draft: { path, fileName, sizeBytes: bytes.byteLength, school: read.school, courses: read.courses },
  };
}

export type SaveTranscriptState = {
  error?: string;
  /** The row of the check list the error is on, and the field. */
  row?: number;
  field?: string;
  saved?: { school: string; courses: number };
};

/** Keep a transcript and the courses you checked on it. */
// latency: pending
export async function saveTranscriptAction(
  _prev: SaveTranscriptState,
  form: FormData,
): Promise<SaveTranscriptState> {
  const user = await requireUser();
  const get = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : null;
  };

  const path = get('path') ?? '';
  const fileName = (get('fileName') ?? '').trim().slice(0, 255);
  const sizeBytes = Number(get('sizeBytes'));
  const mimeType = transcriptContentType(path);
  if (!ownsTranscriptPath(user.id, path) || !fileName || !mimeType || !isTranscriptSize(sizeBytes)) {
    return { error: 'That upload could not be found. Upload the transcript again.' };
  }

  const school = schoolField.safeParse(get('school') ?? '');
  if (!school.success) return { error: school.error.issues[0]?.message, field: 'school' };

  const courses = parseCourseRows(get, parseRowList(get('rows')), school.data);
  if (!courses.ok) return { error: courses.error, row: courses.row, field: courses.field };

  const you = await createYouClient();
  const { data: transcript, error } = await you
    .from('transcripts')
    .insert({
      user_id: user.id,
      school: school.data,
      file_name: fileName,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: sizeBytes,
    })
    .select('id')
    .single();
  if (error || !transcript) {
    return {
      error:
        error?.code === '23505'
          ? 'That transcript is already saved.'
          : 'The transcript was not saved. Try again.',
    };
  }

  const { error: coursesError } = await you.from('courses').insert(
    courses.courses.map((course, position) => ({
      ...course,
      user_id: user.id,
      transcript_id: transcript.id,
      position,
    })),
  );
  if (coursesError) {
    // Take the transcript back out, so a retry does not meet a half-saved copy.
    await you.from('transcripts').delete().eq('id', transcript.id).eq('user_id', user.id);
    return { error: 'The courses were not saved. Try again.' };
  }

  revalidatePath(EDUCATION_HREF);
  return { saved: { school: school.data, courses: courses.courses.length } };
}

/** Remove a file you read and chose not to keep. A saved transcript's file is left alone. */
// latency: instant
export async function discardUploadAction(path: string): Promise<void> {
  const user = await requireUser();
  if (!ownsTranscriptPath(user.id, path)) return;
  const you = await createYouClient();
  const { data } = await you.from('transcripts').select('id').eq('storage_path', path).limit(1);
  if (data && data.length > 0) return;
  await you.storage.from(TRANSCRIPTS_BUCKET).remove([path]);
}

export type CourseEditState = { error?: string; field?: string; saved?: boolean };

const id = z.string().uuid();

/** Correct a saved course. */
// latency: pending
export async function updateCourseAction(_prev: CourseEditState, form: FormData): Promise<CourseEditState> {
  const user = await requireUser();
  const courseId = id.safeParse(form.get('id'));
  if (!courseId.success) return { error: 'That course could not be found.' };

  const you = await createYouClient();
  const { data: current } = await you
    .from('courses')
    .select('school')
    .eq('id', courseId.data)
    .maybeSingle();
  if (!current) return { error: 'That course could not be found.' };

  const read = parseCourse((field) => {
    const value = form.get(field);
    return typeof value === 'string' ? value : '';
  }, (current as { school: string }).school);
  if (!read.ok) return { error: read.error, field: read.field };

  const { error } = await you
    .from('courses')
    .update(read.course)
    .eq('id', courseId.data)
    .eq('user_id', user.id);
  if (error) return { error: 'The course was not saved. Try again.' };

  revalidatePath(EDUCATION_HREF);
  return { saved: true };
}

export type RemoveResult = { ok: boolean; error?: string };

/** Remove one course from a transcript, with the files kept under it. */
// latency: pending
export async function removeCourseAction(form: FormData): Promise<RemoveResult> {
  const user = await requireUser();
  const courseId = id.safeParse(form.get('id'));
  if (!courseId.success) return { ok: false, error: 'That course could not be found.' };
  const you = await createYouClient();
  try {
    await deleteCourse(you as unknown as TranscriptStore, user.id, courseId.data);
  } catch {
    return { ok: false, error: 'The course was not removed. Try again.' };
  }
  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}

/** Delete a transcript, its courses, its original file and the files kept under its courses. */
// latency: pending
export async function removeTranscriptAction(form: FormData): Promise<RemoveResult> {
  const user = await requireUser();
  const transcriptId = id.safeParse(form.get('id'));
  if (!transcriptId.success) return { ok: false, error: 'That transcript could not be found.' };
  const you = await createYouClient();
  try {
    await deleteTranscript(you as unknown as TranscriptStore, user.id, transcriptId.data);
  } catch {
    return { ok: false, error: 'The transcript was not deleted. Try again.' };
  }
  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}

export type CourseExplainState = {
  error?: string;
  /** What the answer showed on each topic it went to (plan #2172.4.2). */
  results?: TopicResult[];
  /** The answer as sent, kept in the box when grading fails. */
  response?: string;
};

const ExplainInput = z.object({
  id: z.string().uuid(),
  response: z.string().trim().min(1).max(8_000),
});

/**
 * Answer a graded course's one explain prompt (plan #2172.4.2). The answer is
 * graded against the topics the course was named for, and on each topic it
 * reached the course's band gives way to the level it showed
 * (lib/learn/evidence/course-explain-store.ts).
 */
// latency: pending
export async function answerCourseExplainAction(
  prev: CourseExplainState,
  form: FormData,
): Promise<CourseExplainState> {
  const user = await requireUser();
  const parsed = ExplainInput.safeParse({ id: form.get('id'), response: form.get('response') });
  if (!parsed.success) return { ...prev, error: 'Write an answer first.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'Grading needs ANTHROPIC_API_KEY to be set.', response: parsed.data.response };

  const you = await createYouClient();
  const { data: course } = await you
    .from('courses')
    .select('id, code, title, grade, year')
    .eq('id', parsed.data.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!course) return { error: 'That course could not be found.' };

  const learn = await createLearnClient();
  const spend = collectSpend();
  const result = await answerCourseExplain(learn, user.id, {
    course: course as { id: string; code: string | null; title: string; grade: string | null; year: number | null },
    response: parsed.data.response,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, 'grade-course-explain', spend.reports);

  if (!result.ok) return { error: result.error, response: parsed.data.response };
  revalidatePath(EDUCATION_HREF);
  return { results: result.results };
}

// ---------------------------------------------------------------------------
// Files kept under a course (plan #2401.2)
// ---------------------------------------------------------------------------

export type AddCourseFileInput = {
  courseId: string;
  /** Where the browser put the file: courseFileStoragePath's answer. */
  path: string;
  fileName: string;
  sizeBytes: number;
  kind: string;
  week: string;
};

export type AddCourseFileResult = { ok: true } | { ok: false; error: string };

/**
 * Keep the row for a file the browser has just put in the course's folder of
 * the you-course-files bucket, as the transcript upload does. When the row
 * cannot be written the stored file is removed, so nothing is left in the
 * bucket that the page cannot show or delete.
 */
// latency: pending
export async function addCourseFileAction(input: AddCourseFileInput): Promise<AddCourseFileResult> {
  const user = await requireUser();
  const courseId = id.safeParse(input.courseId);
  const fileName = String(input.fileName ?? '').trim().slice(0, 255);
  const path = String(input.path ?? '');
  const mimeType = courseFileContentType(path);
  const sizeBytes = Number(input.sizeBytes);
  if (
    !courseId.success ||
    !ownsCourseFilePath(user.id, courseId.data, path) ||
    !fileName ||
    !mimeType ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > COURSE_FILE_MAX_BYTES
  ) {
    return { ok: false, error: 'That upload could not be found. Add the file again.' };
  }

  const you = await createYouClient();
  // A path a saved row already holds is that row's file, and is left alone.
  const discard = async () => {
    const { data } = await you.from('course_files').select('id').eq('storage_path', path).limit(1);
    if (data && data.length > 0) return;
    await you.storage.from(COURSE_FILES_BUCKET).remove([path]);
  };

  const kind = parseKind(input.kind);
  const week = parseWeek(input.week);
  if (!kind || !week.ok) {
    await discard();
    return { ok: false, error: !kind ? 'Say what kind of file this is.' : 'A week is a number from 0 to 60.' };
  }

  const { count } = await you
    .from('course_files')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId.data)
    .eq('user_id', user.id);

  const { error } = await you.from('course_files').insert({
    user_id: user.id,
    course_id: courseId.data,
    kind,
    title: courseFileTitle(fileName),
    week: week.week,
    position: count ?? 0,
    file_name: fileName,
    storage_path: path,
    mime_type: mimeType,
    size_bytes: sizeBytes,
  });
  if (error) {
    await discard();
    if (error.message.includes('at most')) {
      return { ok: false, error: `A course holds at most ${COURSE_FILES_MAX} files.` };
    }
    if (error.code === '23503') return { ok: false, error: 'That course could not be found.' };
    return { ok: false, error: 'The file was not saved. Try again.' };
  }

  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}

/** Remove one file kept under a course, and its stored original. */
// latency: pending
export async function removeCourseFileAction(form: FormData): Promise<RemoveResult> {
  const user = await requireUser();
  const fileId = id.safeParse(form.get('id'));
  if (!fileId.success) return { ok: false, error: 'That file could not be found.' };
  const you = await createYouClient();
  try {
    await deleteCourseFile(you as unknown as TranscriptStore, user.id, fileId.data);
  } catch {
    return { ok: false, error: 'The file was not removed. Try again.' };
  }
  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dash's summary of a course file (plan #2401.4)
// ---------------------------------------------------------------------------

export type SummariseCourseFileState = { error?: string; summarised?: boolean };

/**
 * Have Dash read one file kept under a course and keep a short summary and
 * up to five key points for it in you.course_file_summaries. It runs only on
 * a press of Summarise, as decision #2401.3 chose, and is paid for each time.
 * A second press replaces the summary. A read that fails keeps nothing,
 * leaves any earlier summary as it was, and says why.
 */
// latency: pending
export async function summariseCourseFileAction(
  _prev: SummariseCourseFileState,
  form: FormData,
): Promise<SummariseCourseFileState> {
  const user = await requireUser();
  const fileId = id.safeParse(form.get('id'));
  if (!fileId.success) return { error: 'That file could not be found.' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'This deployment has no ANTHROPIC_API_KEY, so Dash cannot read files.' };

  const you = await createYouClient();
  const { data: row } = await you
    .from('course_files')
    .select('id, course_id, kind, title, week, storage_path, courses(title)')
    .eq('id', fileId.data)
    .eq('user_id', user.id)
    .maybeSingle();
  const file = row as
    | (Pick<CourseFile, 'id' | 'course_id' | 'kind' | 'title' | 'week' | 'storage_path'> & {
        courses: { title: string } | { title: string }[] | null;
      })
    | null;
  if (!file) return { error: 'That file could not be found.' };
  const course = Array.isArray(file.courses) ? file.courses[0] : file.courses;

  const { data: blob, error: downloadError } = await you.storage
    .from(COURSE_FILES_BUCKET)
    .download(file.storage_path);
  if (downloadError || !blob) return { error: 'The stored file could not be opened. Try again.' };
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const spend = collectSpend();
  let read: CourseFileRead;
  try {
    read = await readCourseFile(
      {
        name: file.storage_path,
        bytes,
        title: file.title,
        kind: file.kind,
        week: file.week,
        courseTitle: course?.title ?? 'a course',
      },
      (source, system) => askCourseFileModel({ apiKey, onSpend: spend.sink }, source, system),
    );
  } catch {
    read = { ok: false, error: 'That file could not be read. Try again.' };
  }
  await recordSpendReports(await createCoreClient(), user.id, { module: 'you', operation: COURSE_FILE_OPERATION }, spend.reports);

  if (!read.ok) return { error: read.error };

  const { error } = await you.from('course_file_summaries').upsert(
    {
      file_id: file.id,
      user_id: user.id,
      summary: read.summary,
      points: read.points,
      model: COURSE_FILE_MODEL,
      read_at: new Date().toISOString(),
    },
    { onConflict: 'file_id' },
  );
  if (error) return { error: 'The summary was not saved. Try again.' };

  revalidatePath(EDUCATION_HREF);
  return { summarised: true };
}
