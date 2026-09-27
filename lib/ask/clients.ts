import 'server-only';

import { createClient as createPublicClient } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { createTodoClient } from '@/lib/todo/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import type { AskDb, AskSchema, SchemaClient } from './db';

/**
 * The clients Dash's lookups read through (plan #1088): each schema's own,
 * on the signed-in person's session, so row level security decides what is
 * visible. Only works inside a request, since every one reads the cookies.
 *
 * Each client is made once, the first time a lookup asks for its schema, and
 * reused for the rest of the answer.
 */
const FACTORIES: Record<AskSchema, () => Promise<unknown>> = {
  public: createPublicClient,
  core: createCoreClient,
  job_search: createJobsClient,
  obsidian: createVaultClient,
  todo: createTodoClient,
  learn: createLearnClient,
  news: createNewsClient,
  goals: () => createGoalsClient(),
};

export function requestAskDb(): AskDb {
  const made = new Map<AskSchema, Promise<SchemaClient>>();
  return (schema) => {
    let client = made.get(schema);
    if (!client) {
      client = FACTORIES[schema]() as Promise<SchemaClient>;
      made.set(schema, client);
    }
    return client;
  };
}
