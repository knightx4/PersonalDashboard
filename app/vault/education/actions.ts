'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createVaultClient } from '@/lib/vault/auth/server';
import {
  EDUCATION_HREF,
  isTranscriptSize,
  ownsTranscriptPath,
  parseCourse,
  parseCourseRows,
  parseRowList,
  schoolField,
  transcriptContentType,
} from '@/lib/vault/education';
import { askTranscriptModel, TRANSCRIPT_OPERATION } from '@/lib/vault/transcript-model';
import { readTranscript, type DraftCourse } from '@/lib/vault/transcript-read';
import {
  deleteTranscript,
  VAULT_TRANSCRIPTS_BUCKET,
  type TranscriptStore,
} from '@/lib/vault/transcripts';

/**
 * The Education tab's actions (plan #1308, under #1304).
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

  const vault = await createVaultClient();
  const { data, error } = await vault.storage.from(VAULT_TRANSCRIPTS_BUCKET).download(path);
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
    await vault.storage.from(VAULT_TRANSCRIPTS_BUCKET).remove([path]);
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

  const vault = await createVaultClient();
  const { data: transcript, error } = await vault
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

  const { error: coursesError } = await vault.from('courses').insert(
    courses.courses.map((course, position) => ({
      ...course,
      user_id: user.id,
      transcript_id: transcript.id,
      position,
    })),
  );
  if (coursesError) {
    // Take the transcript back out, so a retry does not meet a half-saved copy.
    await vault.from('transcripts').delete().eq('id', transcript.id).eq('user_id', user.id);
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
  const vault = await createVaultClient();
  const { data } = await vault.from('transcripts').select('id').eq('storage_path', path).limit(1);
  if (data && data.length > 0) return;
  await vault.storage.from(VAULT_TRANSCRIPTS_BUCKET).remove([path]);
}

export type CourseEditState = { error?: string; field?: string; saved?: boolean };

const id = z.string().uuid();

/** Correct a saved course. */
// latency: pending
export async function updateCourseAction(_prev: CourseEditState, form: FormData): Promise<CourseEditState> {
  const user = await requireUser();
  const courseId = id.safeParse(form.get('id'));
  if (!courseId.success) return { error: 'That course could not be found.' };

  const vault = await createVaultClient();
  const { data: current } = await vault
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

  const { error } = await vault
    .from('courses')
    .update(read.course)
    .eq('id', courseId.data)
    .eq('user_id', user.id);
  if (error) return { error: 'The course was not saved. Try again.' };

  revalidatePath(EDUCATION_HREF);
  return { saved: true };
}

export type RemoveResult = { ok: boolean; error?: string };

/** Remove one course from a transcript. */
// latency: pending
export async function removeCourseAction(form: FormData): Promise<RemoveResult> {
  const user = await requireUser();
  const courseId = id.safeParse(form.get('id'));
  if (!courseId.success) return { ok: false, error: 'That course could not be found.' };
  const vault = await createVaultClient();
  const { error } = await vault.from('courses').delete().eq('id', courseId.data).eq('user_id', user.id);
  if (error) return { ok: false, error: 'The course was not removed. Try again.' };
  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}

/** Delete a transcript, its courses and its original file. */
// latency: pending
export async function removeTranscriptAction(form: FormData): Promise<RemoveResult> {
  const user = await requireUser();
  const transcriptId = id.safeParse(form.get('id'));
  if (!transcriptId.success) return { ok: false, error: 'That transcript could not be found.' };
  const vault = await createVaultClient();
  try {
    await deleteTranscript(vault as unknown as TranscriptStore, user.id, transcriptId.data);
  } catch {
    return { ok: false, error: 'The transcript was not deleted. Try again.' };
  }
  revalidatePath(EDUCATION_HREF);
  return { ok: true };
}
