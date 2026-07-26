import 'server-only';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { serverEnv } from '@/lib/env';
import * as schema from './schema';

/**
 * SERVICE-ROLE DATABASE CLIENT. READ THIS BEFORE USING IT.
 *
 * This connection bypasses RLS entirely. Nothing stops a query here from
 * reading or writing another user's rows, so:
 *
 *   1. It may be imported ONLY from `inngest/` and `scripts/`. An ESLint rule
 *      in eslint.config.mjs blocks importing it from anywhere under `app/`,
 *      `components/` or `lib/auth/`, and CI fails on violation.
 *   2. Every query made through it MUST filter by user_id explicitly, even
 *      though nothing forces it to. The filter that RLS would have applied is
 *      now your responsibility.
 *
 * Background jobs are the only legitimate caller: they act on behalf of a user
 * who is not present to supply a session.
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function adminDb() {
  if (cached) return cached;
  const { DATABASE_URL } = serverEnv();
  const client = postgres(DATABASE_URL, { max: 5, prepare: false });
  cached = drizzle(client, { schema });
  return cached;
}
