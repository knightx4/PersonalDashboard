/**
 * Academic transcripts and the courses on them (plan #1306, under #1304).
 *
 * The tables are you.transcripts and you.courses, and the original
 * files are kept in the private vault-transcripts bucket at
 * `<user id>/<a fresh uuid>-<the file's name>`. See
 * supabase/migrations-vault/0030_transcripts.sql for what the database
 * enforces: each account reads and writes its own rows and its own folder.
 *
 * Courses cascade with their transcript. The file does not, so a transcript
 * is deleted through deleteTranscript, which removes both, and the files kept
 * under its courses too (plan #2401.1, below).
 *
 * Both tables moved from obsidian to the you schema with Education's move
 * to Work & school (plan #1991.3, migrations-you/0004). The bucket kept its
 * name and its files, so the paths saved on the rows still find them.
 */

/** The bucket keeps its first name, from when the transcripts were in the Vault. */
export const TRANSCRIPTS_BUCKET = 'vault-transcripts';

/** 20 MB, the bucket's limit and the table's. */
export const TRANSCRIPT_MAX_BYTES = 20_971_520;

/** The file types the bucket and the table accept. Pasted text is kept as text/plain. */
export const TRANSCRIPT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

export type TranscriptMimeType = (typeof TRANSCRIPT_MIME_TYPES)[number];

export function isTranscriptMimeType(value: string): value is TranscriptMimeType {
  return (TRANSCRIPT_MIME_TYPES as readonly string[]).includes(value);
}

/** A row of you.transcripts. */
export type Transcript = {
  id: string;
  user_id: string;
  school: string;
  file_name: string;
  storage_path: string;
  mime_type: TranscriptMimeType;
  size_bytes: number;
  uploaded_at: string;
  updated_at: string;
};

/** A row of you.courses. term, year, credits and grade are as written, and may be missing. */
export type Course = {
  id: string;
  user_id: string;
  transcript_id: string;
  school: string;
  code: string | null;
  title: string;
  term: string | null;
  year: number | null;
  credits: number | null;
  grade: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

/**
 * Where a new upload goes: the account's folder, then a fresh uuid so two
 * files of the same name never meet, then the name with anything outside a
 * plain set of characters replaced.
 */
export function transcriptStoragePath(userId: string, fileName: string, id: string): string {
  if (!userId) throw new Error('A transcript path needs a user id.');
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'transcript';
  return `${userId}/${id}-${safe}`;
}

// ---------------------------------------------------------------------------
// Files kept under a course (plan #2401.1)
// ---------------------------------------------------------------------------

/**
 * The files a course holds, in you.course_files, are kept in the private
 * you-course-files bucket at `<user id>/<course id>/<a fresh uuid>-<the file's
 * name>`. See supabase/migrations-you/0008_course_files.sql: each account
 * reads and writes its own rows and its own folder, a course holds at most
 * COURSE_FILES_MAX files, and each is at most COURSE_FILE_MAX_BYTES.
 *
 * A file row cascades with its course, which cascades with its transcript.
 * The stored file does not, so a course is deleted through deleteCourse and a
 * transcript through deleteTranscript, which remove the files as well.
 */
export const COURSE_FILES_BUCKET = 'you-course-files';

/** 20 MB, the bucket's limit and the table's, the same as a transcript's. */
export const COURSE_FILE_MAX_BYTES = TRANSCRIPT_MAX_BYTES;

/** Most files one course holds. The database refuses the next one. */
export const COURSE_FILES_MAX = 20;

/** The transcript types and PowerPoint, for lecture slides. */
export const COURSE_FILE_MIME_TYPES = [
  ...TRANSCRIPT_MIME_TYPES,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type CourseFileMimeType = (typeof COURSE_FILE_MIME_TYPES)[number];

export function isCourseFileMimeType(value: string): value is CourseFileMimeType {
  return (COURSE_FILE_MIME_TYPES as readonly string[]).includes(value);
}

/** What a kept file is, in the order the page offers them. */
export const COURSE_FILE_KINDS = ['syllabus', 'slides', 'lecture_notes', 'reading'] as const;

export type CourseFileKind = (typeof COURSE_FILE_KINDS)[number];

export const COURSE_FILE_KIND_LABELS: Record<CourseFileKind, string> = {
  syllabus: 'Syllabus',
  slides: 'Slides',
  lecture_notes: 'Lecture notes',
  reading: 'Reading',
};

export function isCourseFileKind(value: string): value is CourseFileKind {
  return (COURSE_FILE_KINDS as readonly string[]).includes(value);
}

/**
 * A row of you.course_files. week is null for a file that spans the course,
 * such as the syllabus; the table takes 0 to 60.
 */
export type CourseFile = {
  id: string;
  user_id: string;
  course_id: string;
  kind: CourseFileKind;
  title: string;
  week: number | null;
  position: number;
  file_name: string;
  storage_path: string;
  mime_type: CourseFileMimeType;
  size_bytes: number;
  uploaded_at: string;
  updated_at: string;
};

/**
 * Where a new course file goes: the account's folder, the course's folder in
 * it, then a fresh uuid and the name made safe, as for a transcript. The
 * table's check holds a row to exactly this folder.
 */
export function courseFileStoragePath(userId: string, courseId: string, fileName: string, id: string): string {
  if (!userId) throw new Error('A course file path needs a user id.');
  if (!courseId) throw new Error('A course file path needs a course id.');
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
  return `${userId}/${courseId}/${id}-${safe}`;
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

type StoreResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };

/** A filter chain, awaited at the end, as supabase-js builds one. */
type StoreQuery = PromiseLike<StoreResult> & {
  eq(column: string, value: string): StoreQuery;
  in(column: string, values: string[]): StoreQuery;
  select(columns: string): StoreQuery;
};

/** The part of a Supabase client the deletes need, so a test can pass a fake. */
export type TranscriptStore = {
  from(table: 'transcripts' | 'courses' | 'course_files'): {
    select(columns: string): StoreQuery;
    delete(): StoreQuery;
  };
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/** The column of every row, failing on a read error. */
async function column(query: StoreQuery, name: string, what: string): Promise<string[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return (data ?? []).map((row) => String(row[name]));
}

async function removeFiles(client: TranscriptStore, bucket: string, paths: string[], what: string): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await client.storage.from(bucket).remove(paths);
  if (error) throw new Error(`Removing ${what} failed: ${error.message}`);
}

/** Where the files of these courses are kept. */
async function courseFilePaths(client: TranscriptStore, userId: string, courseIds: string[]): Promise<string[]> {
  if (courseIds.length === 0) return [];
  return column(
    client.from('course_files').select('storage_path').eq('user_id', userId).in('course_id', courseIds),
    'storage_path',
    "Reading the course's files",
  );
}

/**
 * Delete one transcript: the row, which takes its courses and their file rows
 * with it, then the original and every course's files. The files' paths are
 * read first, so they are known once the rows have gone. The rows go before
 * the files, so a failure part way leaves at worst a file nothing points at,
 * never a row whose file is gone. Returns false when there was no such
 * transcript of this account's.
 */
export async function deleteTranscript(
  client: TranscriptStore,
  userId: string,
  transcriptId: string,
): Promise<boolean> {
  const courseIds = await column(
    client.from('courses').select('id').eq('transcript_id', transcriptId).eq('user_id', userId),
    'id',
    "Reading the transcript's courses",
  );
  const filePaths = await courseFilePaths(client, userId, courseIds);

  const paths = await column(
    client.from('transcripts').delete().eq('id', transcriptId).eq('user_id', userId).select('storage_path'),
    'storage_path',
    'Deleting the transcript',
  );
  if (paths.length === 0) return false;

  await removeFiles(client, TRANSCRIPTS_BUCKET, paths, 'the transcript file');
  await removeFiles(client, COURSE_FILES_BUCKET, filePaths, "the courses' files");
  return true;
}

/**
 * Delete one course, its file rows with it, then its files, in the same
 * order as deleteTranscript. Returns false when there was no such course of
 * this account's.
 */
export async function deleteCourse(client: TranscriptStore, userId: string, courseId: string): Promise<boolean> {
  const filePaths = await courseFilePaths(client, userId, [courseId]);

  const deleted = await column(
    client.from('courses').delete().eq('id', courseId).eq('user_id', userId).select('id'),
    'id',
    'Deleting the course',
  );
  if (deleted.length === 0) return false;

  await removeFiles(client, COURSE_FILES_BUCKET, filePaths, "the course's files");
  return true;
}

/**
 * Delete one file kept under a course: the row, then the stored file, in the
 * same order as deleteTranscript. Returns false when there was no such file
 * of this account's (plan #2401.2).
 */
export async function deleteCourseFile(client: TranscriptStore, userId: string, fileId: string): Promise<boolean> {
  const paths = await column(
    client.from('course_files').delete().eq('id', fileId).eq('user_id', userId).select('storage_path'),
    'storage_path',
    'Deleting the file',
  );
  if (paths.length === 0) return false;

  await removeFiles(client, COURSE_FILES_BUCKET, paths, 'the stored file');
  return true;
}
