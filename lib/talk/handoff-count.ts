import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Dev Home's count of hand-offs to a Claude Code session still open (plan
 * #3005.5): waiting for a session to start, or being worked. It reads the
 * partial index dash_handoffs_session_open_idx (user_id, created_at where
 * kind = 'session' and status in ('pending', 'fired')), so the count touches
 * only the open rows.
 */
export type OpenSessions = { waiting: number; working: number };

/** The open session hand-offs, split by state. Null when they could not be read. */
export async function loadOpenSessionCount(core: CoreSupabaseClient, userId: string): Promise<OpenSessions | null> {
  try {
    const { data, error } = await core
      .from('dash_handoffs')
      .select('status')
      .eq('user_id', userId)
      .eq('kind', 'session')
      .in('status', ['pending', 'fired'])
      .limit(200);
    if (error) {
      console.error('the open session hand-offs were not read', error.message);
      return null;
    }
    const rows = (data ?? []) as { status: string }[];
    const working = rows.filter((r) => r.status === 'fired').length;
    return { waiting: rows.length - working, working };
  } catch (error) {
    console.error('the open session hand-offs were not read', error);
    return null;
  }
}
