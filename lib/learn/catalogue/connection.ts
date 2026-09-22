import 'server-only';

import postgres from 'postgres';
import { serverEnv } from '@/lib/env';

/**
 * The connection the catalogue is written through from inside the app.
 *
 * `storeArticle` and `embedCatalogueSegments` take a `postgres` connection,
 * because the catalogue tables carry no user id and have no insert policy: they
 * are reference data shared by every account, and only a privileged connection
 * can write them. scripts/learn-catalogue.ts opens its own. This is the same
 * thing for the server action on a subject page, so the deployed app can fill
 * the catalogue without anybody running the script.
 *
 * It carries the service role, like lib/db/admin.ts, and the same rule
 * applies: the one row written through it that belongs to somebody is the
 * spend row, and `catalogueLedger` names that account explicitly. Use it for
 * the catalogue and nothing else.
 *
 * One pool per server instance, kept between presses. `prepare: false`, as in
 * lib/db/admin.ts, so it also works through Supabase's transaction pooler.
 */

let cached: postgres.Sql | null = null;

export function catalogueSql(): postgres.Sql {
  if (cached) return cached;
  const { DATABASE_URL } = serverEnv();
  cached = postgres(DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
  return cached;
}
