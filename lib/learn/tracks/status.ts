import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { recordOutcome } from '@/lib/learn/next/record';
import { setReadingStatus } from './save';

export type ReadingStatus = 'queued' | 'reading' | 'read' | 'abandoned';

/**
 * Move a reading to a status, as the reading page's buttons and Dash's
 * change_reading both do (plan #2473.5). Finishing it is also what Learn next
 * orders from (#479: reading it counts and giving up on it does not), so a
 * reading marked read records that outcome; a reading finished twice is one
 * fact, which the unique index on next_outcomes keeps.
 */
export async function markReadingStatus(
  supabase: LearnSupabaseClient,
  userId: string,
  readingId: string,
  status: ReadingStatus,
): Promise<void> {
  await setReadingStatus(supabase, readingId, status, userId);
  if (status === 'read') {
    await recordOutcome(supabase, userId, { kind: 'reading', readingId, outcome: 'read' });
  }
}
