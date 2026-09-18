'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createNewsClient } from '@/lib/news/auth/server';
import { markUnread } from '@/lib/news/issues/read';

const UnreadInput = z.object({ issueId: z.string().uuid() });

/**
 * Put an issue back in the unread list, and go there.
 *
 * It ends on /news rather than on the issue because opening the issue is what
 * marks it read: staying would set the time again on the next render and the
 * button would do nothing you could see.
 */
// latency: pending
export async function markIssueUnread(formData: FormData): Promise<void> {
  const parsed = UnreadInput.safeParse({ issueId: formData.get('issueId') });
  if (!parsed.success) return;

  const client = await createNewsClient();
  await markUnread(client, parsed.data.issueId);

  revalidatePath('/news');
  redirect('/news');
}
