'use client';

import { createClient } from '@/lib/auth/client';
import { publicEnv } from '@/lib/env';
import { COURSE_FILES_BUCKET, courseFileStoragePath } from '@/lib/you/transcripts';

/**
 * Put one course file in the account's folder of the you-course-files bucket,
 * reporting how much has gone (plan #2401.2).
 *
 * supabase-js uploads with fetch, which says nothing until the file has
 * arrived, so this posts to the same storage endpoint with an
 * XMLHttpRequest, whose upload events give the row its progress bar. It runs
 * on your session's token, so the bucket's policies decide the folder exactly
 * as they do for supabase-js. Nothing is ever written over: x-upsert is false.
 */
export async function uploadCourseFile(
  courseId: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<{ path: string } | { error: string }> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return { error: 'You are signed out. Sign in again to upload.' };

  const path = courseFileStoragePath(session.user.id, courseId, file.name, crypto.randomUUID());
  const { NEXT_PUBLIC_SUPABASE_URL: base, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon } = publicEnv();
  const url = `${base}/storage/v1/object/${COURSE_FILES_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', anon);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve({ path });
      } else {
        resolve({ error: storageError(xhr.status, xhr.responseText) });
      }
    };
    xhr.onerror = () => resolve({ error: 'The connection dropped. Try again.' });
    xhr.send(file);
  });
}

/** What a refused upload says, in the page's words rather than the store's. */
function storageError(status: number, body: string): string {
  if (status === 413 || /exceed|too large|size/i.test(body)) return 'Over 20 MB, which the store will not keep.';
  if (/mime|content type/i.test(body)) return 'The store does not keep this kind of file.';
  if (status === 401 || status === 403) return 'You are signed out. Sign in again to upload.';
  return 'The file could not be uploaded. Try again.';
}
