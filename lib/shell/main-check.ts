import 'server-only';

import { createClient } from '@/lib/auth/server';
import { REPO_KEY } from '@/lib/plan/ci';
import type { CheckConclusion } from '@/lib/plan/checks';
import type { DeployState } from '@/lib/plan/deploy';
import type { MainCheck } from '@/lib/plan/main-check';

/**
 * Whether main is green, as the shell reads it.
 *
 * One primary-key lookup of one row, and nothing else. The status line is
 * rendered on every page in the app, so this is the read that has to stay
 * cheap no matter what else is happening: it never talks to GitHub, never
 * counts anything and never joins. The asking is the overnight tick's job
 * (`lib/plan/ci.ts` `refreshMainCheck`, every four minutes), and this only
 * reads what it wrote down.
 *
 * Best-effort, the same as `loadActivity` beside it and for the same reason: a
 * status line that can take a page down is a status line that should not
 * exist. A table that is not there yet, a read that is refused, a session that
 * has expired -- all of them come back as null, which the dot draws as "not
 * read", which is true.
 */
export async function loadMainCheck(): Promise<MainCheck | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('plan_main_checks')
      .select(
        'head_sha, conclusion, checked_at, error, reason, run_url, deploy_state, deploy_url, deploy_error, unapplied_migrations, migrations_error',
      )
      .eq('repo', REPO_KEY)
      .maybeSingle();
    if (error || !data) return null;

    const row = data as {
      head_sha: string | null;
      conclusion: string | null;
      checked_at: string;
      error: string | null;
      reason: string | null;
      run_url: string | null;
      deploy_state: string | null;
      deploy_url: string | null;
      deploy_error: string | null;
      unapplied_migrations: string[] | null;
      migrations_error: string | null;
    };
    return {
      sha: row.head_sha,
      // The column is constrained to the conclusions main's head can take, so
      // the cast is the constraint restated rather than a hope.
      conclusion: (row.conclusion as CheckConclusion | null) ?? null,
      checkedAt: row.checked_at,
      error: row.error,
      reason: row.reason,
      runUrl: row.run_url,
      // Constrained in 0096 to the four DeployState words, as `conclusion` is.
      deployState: (row.deploy_state as DeployState | null) ?? null,
      deployUrl: row.deploy_url,
      deployError: row.deploy_error,
      unapplied: row.unapplied_migrations,
      migrationsError: row.migrations_error,
    };
  } catch {
    return null;
  }
}
