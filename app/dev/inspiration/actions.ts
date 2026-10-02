'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { parsePlaylistInput } from '@/lib/learn/providers/youtube';

/**
 * The Inspiration tab's writes (plan #1412). Each one refuses anybody but the
 * owner in its own right, since an action can be posted without the Dev
 * layout ever rendering (#417), and ends by revalidating the page.
 */

export type InspirationActionState = { error?: string; message?: string };

const INSPIRATION_PATH = '/dev/inspiration';

/**
 * Point the tab at another playlist.
 *
 * Takes a link or a bare id. The read time and any error belong to the old
 * playlist, so both are cleared; the videos already read stay, and the next
 * read marks the ones not on the new playlist as taken off.
 */
// latency: pending
export async function setInspirationPlaylist(
  _prev: InspirationActionState,
  formData: FormData,
): Promise<InspirationActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const parsed = parsePlaylistInput(String(formData.get('playlist') ?? ''));
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.from('inspiration_settings').upsert(
    {
      user_id: user.id,
      youtube_playlist_id: parsed.playlistId,
      playlist_read_at: null,
      playlist_error: null,
    },
    { onConflict: 'user_id' },
  );
  if (error) return { error: error.message };

  revalidatePath(INSPIRATION_PATH);
  return { message: 'Playlist saved.' };
}
