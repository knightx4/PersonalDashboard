'use client';

import { createClient } from '@/lib/auth/client';
import { POST_IMAGE_MAX_BYTES, POST_IMAGE_TYPES, POST_IMAGES_BUCKET, postImagePath } from '@/lib/dev/posts';

/**
 * Put an image in your folder of the post-images bucket, under a fresh name,
 * straight from the browser (migration 0192's policies allow only your own
 * folder). The action that follows records the path it returns.
 */
export async function uploadPostImage(file: File): Promise<{ path: string } | { error: string }> {
  if (!POST_IMAGE_TYPES.includes(file.type)) return { error: 'Use a PNG, JPEG, GIF or WebP image.' };
  if (file.size > POST_IMAGE_MAX_BYTES) return { error: 'That image is over 10 MB.' };
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: 'You are signed out. Sign in again to upload.' };
  const path = postImagePath(data.user.id, crypto.randomUUID(), file.name);
  const { error } = await supabase.storage
    .from(POST_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: 'That image could not be uploaded. Try again.' };
  return { path };
}
