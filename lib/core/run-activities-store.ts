import 'server-only';
import { RUN_ACTIVITY_COLUMNS, runActivityFrom, type RunActivity } from './run-activities';

/** The part of a Supabase client the read needs: any client that can reach the core schema. */
type CoreReader = {
  schema: (name: 'core') => {
    from: (table: 'run_activities') => {
      select: (columns: string) => {
        eq: (column: 'run_id', value: string) => {
          order: (
            column: 'created_at',
            options: { ascending: boolean },
          ) => {
            limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
};

/**
 * The lines one run has written, oldest first, read on the viewer's own
 * session so RLS keeps them to the run's owner (plan #1826). A run writes a
 * few dozen; 500 is far past any and keeps a runaway one from filling the
 * page. A failed read draws no lines rather than failing the page, since the
 * page subscribes and reads again in the browser.
 */
export async function loadRunActivities(client: unknown, runId: string): Promise<RunActivity[]> {
  const { data, error } = await (client as CoreReader)
    .schema('core')
    .from('run_activities')
    .select(RUN_ACTIVITY_COLUMNS)
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error(`Could not read the run's lines: ${error.message}`);
    return [];
  }
  return (data ?? [])
    .map((row) => runActivityFrom(row as Record<string, unknown>))
    .filter((line): line is RunActivity => line !== null);
}
