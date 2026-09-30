/**
 * Academic transcripts and the courses on them (plan #1306, under #1304).
 *
 * The tables are obsidian.transcripts and obsidian.courses, and the original
 * files are kept in the private vault-transcripts bucket at
 * `<user id>/<a fresh uuid>-<the file's name>`. See
 * supabase/migrations-vault/0030_transcripts.sql for what the database
 * enforces: each account reads and writes its own rows and its own folder.
 *
 * Courses cascade with their transcript. The file does not, so a transcript
 * is deleted through deleteTranscript, which removes both.
 */

export const VAULT_TRANSCRIPTS_BUCKET = 'vault-transcripts';

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

/** A row of obsidian.transcripts. */
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

/** A row of obsidian.courses. term, year, credits and grade are as written, and may be missing. */
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

/** The part of a Supabase client deleteTranscript needs, so a test can pass a fake. */
export type TranscriptStore = {
  from(table: 'transcripts'): {
    delete(): {
      eq(
        column: 'id',
        value: string,
      ): {
        eq(
          column: 'user_id',
          value: string,
        ): {
          select(columns: 'storage_path'): PromiseLike<{
            data: Array<{ storage_path: string }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Delete one transcript: the row, which takes its courses with it, then the
 * original file. The row goes first, so a failure part way leaves at worst a
 * file nothing points at, never a transcript whose file is gone. Returns
 * false when there was no such transcript of this account's.
 */
export async function deleteTranscript(
  client: TranscriptStore,
  userId: string,
  transcriptId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('transcripts')
    .delete()
    .eq('id', transcriptId)
    .eq('user_id', userId)
    .select('storage_path');
  if (error) throw new Error(`Deleting the transcript failed: ${error.message}`);

  const paths = (data ?? []).map((row) => row.storage_path);
  if (paths.length === 0) return false;

  const removed = await client.storage.from(VAULT_TRANSCRIPTS_BUCKET).remove(paths);
  if (removed.error) throw new Error(`Removing the transcript file failed: ${removed.error.message}`);
  return true;
}
