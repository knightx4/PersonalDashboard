import 'server-only';

import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { rolesSource, type DraftSource } from '@/lib/learn/levels/draft-sources';

/**
 * The requirement lines of the roles in job_search a goal names, as a source
 * to draft a topic from (plan #2138.11). A role is named by a phrase its
 * title contains, such as "FP&A"; its lines are the must-haves and
 * nice-to-haves extracted from the posting (`roles.requirements`), not its
 * list of responsibilities. Read through the person's own client, so RLS
 * keeps it to their roles.
 */

const MAX_ROLES = 12;

type RawRole = {
  title: string;
  requirements: { text?: unknown; kind?: unknown }[] | null;
  company: { name: string } | null;
};

export async function roleRequirementSource(phrase: string): Promise<Omit<DraftSource, 'id'> | null> {
  if (phrase.trim() === '') return null;
  return roleRequirementSourceFrom(await createJobsClient(), phrase);
}

/**
 * The same read through a client the caller gives. A service-role client
 * sees every account, so it names whose roles to read (`owner`); the
 * territory drafter (plan #2172.6) runs that way.
 */
export async function roleRequirementSourceFrom(
  jobs: AppSupabaseClient,
  phrase: string,
  owner?: string,
): Promise<Omit<DraftSource, 'id'> | null> {
  const words = phrase.trim();
  if (words === '') return null;
  const pattern = `%${words.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  let query = jobs.from('roles').select('title, requirements, company:companies(name)');
  if (owner) query = query.eq('user_id', owner);
  const { data, error } = await query
    .ilike('title', pattern)
    .not('requirements', 'is', null)
    .order('first_seen_at', { ascending: false })
    .limit(MAX_ROLES);
  if (error) throw new Error(`Reading your roles failed: ${error.message}`);
  const roles = ((data ?? []) as unknown as RawRole[]).map((role) => ({
    title: role.title,
    company: role.company?.name ?? null,
    lines: (Array.isArray(role.requirements) ? role.requirements : []).flatMap((r) =>
      typeof r.text === 'string' && (r.kind === 'must_have' || r.kind === 'nice_to_have') ? [r.text] : [],
    ),
  }));
  return rolesSource(words, roles.filter((r) => r.lines.length > 0));
}
