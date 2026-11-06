'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { resendBotHandoff } from '@/lib/talk/bot-handoffs';
import { startBotHandoffReceiver } from '@/lib/talk/hand-to-bot-store';

/**
 * Resend on a flagged bot hand-off (plan #3003.4). The same row goes back to
 * sent, so the dedupe key is the one it was passed with and no second row
 * is kept, and the receiving bot's run is started on it as when it was first
 * passed. A row already resent, or one the receiver had picked up, does not
 * move, and nothing is started.
 */
// latency: pending
export async function resendFlaggedHandoff(id: string): Promise<{ ok: boolean }> {
  await requireOwner();
  const user = await requireUser();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false };

  const core = await createCoreClient();
  const moved = await resendBotHandoff(core, parsed.data);
  if (moved) startBotHandoffReceiver(user.id, parsed.data);
  revalidatePath('/dev/raised');
  return { ok: moved };
}
