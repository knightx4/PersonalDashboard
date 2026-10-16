import 'server-only';

import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts } from '@/lib/learn/embed/embed';
import { ledgerIdeaSpend } from '@/lib/learn/embed/idea-embedding';
import {
  bestLine,
  roleLinesFrom,
  type RawRole,
  type RoleLine,
  type RoleLineFinder,
} from '@/lib/learn/levels/role-line';

/**
 * Match a topic to the requirement line of a role you pursued, by embedding
 * (plan #2184.2). Nothing is stored: the lines are read from job_search.roles
 * and embedded as they are needed, and the vectors are kept in memory for
 * half an hour so a run of questions embeds them once.
 */

const MAX_ROLES = 60;
const KEEP_MS = 30 * 60_000;

type Embedded = { at: number; items: { vector: number[]; line: RoleLine }[] };
const kept = new Map<string, Embedded>();

type Reports = NonNullable<Parameters<typeof ledgerIdeaSpend>[2]>;

async function loadLines(jobs: AppSupabaseClient): Promise<RoleLine[]> {
  const { data, error } = await jobs
    .from('roles')
    .select('id, title, requirements, company:companies(name)')
    .not('requirements', 'is', null)
    .order('first_seen_at', { ascending: false })
    .limit(MAX_ROLES);
  if (error) throw new Error(`Reading your roles failed: ${error.message}`);
  return roleLinesFrom((data ?? []) as unknown as RawRole[]);
}

/**
 * A finder for one person. Returns null for a topic with no line near it,
 * and for any failure (no key, no roles, a read that failed): a card without
 * a role's name is the ordinary card.
 */
export function roleLineFinder(learn: LearnSupabaseClient, userId: string): RoleLineFinder {
  return async (topicName) => {
    const reports: Reports = [];
    try {
      const name = topicName.trim();
      if (name === '') return null;
      let held = kept.get(userId);
      if (!held || Date.now() - held.at > KEEP_MS) {
        const lines = await loadLines(await createJobsClient());
        if (lines.length === 0) return null;
        const embedded = await embedTexts({
          texts: lines.map((l) => l.line),
          inputType: 'document',
          onSpend: (r) => reports.push(r),
        });
        if (!embedded.ok) return null;
        held = { at: Date.now(), items: lines.map((line, i) => ({ line, vector: embedded.vectors[i] })) };
        kept.set(userId, held);
      }
      const topic = await embedTexts({ texts: [name], inputType: 'query', onSpend: (r) => reports.push(r) });
      if (!topic.ok) return null;
      return bestLine(topic.vectors[0], held.items);
    } catch (error) {
      console.warn('[learn roles] matching a topic to a requirement line failed', error);
      return null;
    } finally {
      await ledgerIdeaSpend(learn, userId, reports);
    }
  };
}
