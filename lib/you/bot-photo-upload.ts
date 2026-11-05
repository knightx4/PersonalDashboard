'use client';

import { createClient } from '@/lib/auth/client';
import { BOT_PHOTOS_BUCKET, botPhotoPath, botPhotoProblem } from '@/lib/you/bot-photos-model';

/**
 * Put a picture for one bot in the account's folder of the you-bot-photos
 * bucket (plan #2955), on the person's own session, so the bucket's policies
 * decide the folder. Nothing is written over: each upload takes a fresh
 * name. The form then saves the path with saveBotPhoto.
 */
export async function uploadBotPhoto(advisorId: string, file: File): Promise<{ path: string } | { error: string }> {
  const problem = botPhotoProblem(file);
  if (problem) return { error: problem };
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return { error: 'You are signed out. Sign in again to upload.' };
  const path = botPhotoPath(session.user.id, advisorId, crypto.randomUUID(), file.type);
  const { error } = await supabase.storage.from(BOT_PHOTOS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error('bot picture not uploaded', error);
    return { error: /size|large|exceed/i.test(error.message) ? 'Choose an image under 5 MB.' : 'The picture could not be uploaded. Try again.' };
  }
  return { path };
}
