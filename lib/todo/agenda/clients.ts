import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createShoppingClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { createTodoClient } from '@/lib/todo/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { TodoSupabaseClient } from '@/lib/todo/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Where the agenda gets its database clients, one per schema.
 *
 * A page reads the agenda on the signed-in person's session, so RLS decides
 * whose rows come back. The morning brief (plan #1123) reads the same agenda
 * from a cron route, where there is no session: it passes service-role
 * clients built in inngest/core/day-brief.ts instead. That is safe only
 * because every read the agenda makes names the person, by user_id or by ids
 * taken from their own rows; a new source or loader must do the same.
 */
export interface AgendaClients {
  shopping(): Promise<SupabaseClient>;
  jobs(): Promise<AppSupabaseClient>;
  todo(): Promise<TodoSupabaseClient>;
  goals(): Promise<GoalsSupabaseClient>;
  core(): Promise<CoreSupabaseClient>;
  learn(): Promise<LearnSupabaseClient>;
  vault(): Promise<VaultSupabaseClient>;
  /** For a task made from a newsletter story (plan #1369). */
  news(): Promise<NewsSupabaseClient>;
}

/** The signed-in person's own clients, under RLS. What every page uses. */
export const sessionClients: AgendaClients = {
  shopping: () => createShoppingClient(),
  jobs: () => createJobsClient() as Promise<AppSupabaseClient>,
  todo: () => createTodoClient(),
  goals: () => createGoalsClient(),
  core: () => createCoreClient(),
  learn: () => createLearnClient(),
  vault: () => createVaultClient(),
  news: () => createNewsClient(),
};
