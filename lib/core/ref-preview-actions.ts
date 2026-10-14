'use server';

import { requestAskDb } from '@/lib/ask/clients';
import { createClient, requireUser } from '@/lib/auth/server';
import { isPreviewKey, type RefPreview } from '@/lib/core/ref-preview';
import { loadRefPreview } from '@/lib/core/ref-preview-server';

/**
 * What a ref link previews on hover or hold (plan #1931.4), read on the
 * person's session so row level security decides what they can see. A key
 * that is neither a ref nor a step, and a read that fails, answer null: the
 * link still works, it just shows nothing before it is followed.
 */
export async function previewRef(key: string): Promise<RefPreview | null> {
  if (typeof key !== 'string' || key.length > 200 || !isPreviewKey(key)) return null;
  const user = await requireUser();
  try {
    return await loadRefPreview(key, {
      db: requestAskDb(),
      supabase: await createClient(),
      userId: user.id,
    });
  } catch (err) {
    console.error(`ref preview ${key}: ${err instanceof Error ? err.message : 'failed'}`);
    return null;
  }
}
