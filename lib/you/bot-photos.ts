import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { BOT_PHOTOS_BUCKET, isBotPhotoPath } from '@/lib/you/bot-photos-model';

export * from '@/lib/you/bot-photos-model';

/**
 * Reading and changing a bot's picture (plan #2955). The browser uploads the
 * image to the you-bot-photos bucket on the person's own session; setBotPhoto
 * then points the bot at it and removes the picture it replaces. Pages show
 * the pictures through signed links made here.
 */

/** How long a signed link to a picture lasts. Chat's pages are read fresh, so a day is plenty. */
const SIGNED_FOR_SECONDS = 24 * 60 * 60;

/** A signed link for each stored path; a path that could not be signed is left out, and draws the initials. */
export async function signBotPhotos(client: YouSupabaseClient, paths: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => typeof p === 'string' && p.length > 0))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const { data, error } = await client.storage.from(BOT_PHOTOS_BUCKET).createSignedUrls(wanted, SIGNED_FOR_SECONDS);
  if (error) {
    console.error('bot pictures were not signed', error);
    return out;
  }
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
  }
  return out;
}

/** Every bot's stored picture path, by advisor id. */
export async function readBotPhotoPaths(client: YouSupabaseClient, userId: string): Promise<Map<string, string>> {
  const { data, error } = await client.from('board_advisors').select('id, photo_path').eq('user_id', userId).not('photo_path', 'is', null);
  if (error) throw new Error(`Reading your bots' pictures failed: ${error.message}`);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as { id?: unknown; photo_path?: unknown }[]) {
    if (typeof row.id === 'string' && typeof row.photo_path === 'string') out.set(row.id, row.photo_path);
  }
  return out;
}

/** Each bot's signed picture link, by advisor id; bots with none are absent. */
export async function loadBotPhotos(client: YouSupabaseClient, userId: string): Promise<Map<string, string>> {
  const paths = await readBotPhotoPaths(client, userId);
  const signed = await signBotPhotos(client, [...paths.values()]);
  const out = new Map<string, string>();
  for (const [id, path] of paths) {
    const url = signed.get(path);
    if (url) out.set(id, url);
  }
  return out;
}

/** Remove stored pictures, saying so in the log rather than failing the change that left them behind. */
export async function removeBotPhotos(client: YouSupabaseClient, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await client.storage.from(BOT_PHOTOS_BUCKET).remove([...paths]);
  if (error) console.error('old bot picture was not removed', error);
}

/**
 * Point the bot at a new picture, or at none with null, and remove the one
 * it replaces. Returns false when the id names no bot of theirs. Throws on a
 * path that is not one the upload would have made for this bot.
 */
export async function setBotPhoto(
  client: YouSupabaseClient,
  userId: string,
  advisorId: string,
  path: string | null,
): Promise<boolean> {
  if (path !== null && !isBotPhotoPath(path, userId, advisorId)) throw new Error('That picture is not filed under this bot.');
  const found = await client.from('board_advisors').select('photo_path').eq('user_id', userId).eq('id', advisorId).eq('active', true).maybeSingle();
  if (found.error) throw new Error(`Reading them failed: ${found.error.message}`);
  if (!found.data) return false;
  const old = (found.data as { photo_path?: unknown }).photo_path;
  const saved = await client.from('board_advisors').update({ photo_path: path }).eq('user_id', userId).eq('id', advisorId);
  if (saved.error) throw new Error(`Saving the picture failed: ${saved.error.message}`);
  if (typeof old === 'string' && old && old !== path) await removeBotPhotos(client, [old]);
  return true;
}
