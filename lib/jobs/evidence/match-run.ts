import { createClient } from '@/lib/jobs/auth/server';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { matchRequirements } from './match';
import { matchKey, type RequirementMatch } from './match-payload';
import { shortlistEvidence } from './shortlist';

/**
 * The Match button's press as a plain function (plan #2228.3): the server
 * action (app/jobs/(app)/roles/[id]/posting-actions.ts) and Dash's
 * match_role_requirements tool both call it, so a match Dash makes on
 * approval is stored and priced as the button's is. It runs as the signed-in
 * person, through the cookie client.
 */
export async function matchRoleRequirementsFor(
  userId: string,
  apiKey: string,
  roleId: string,
): Promise<{ matches: RequirementMatch[] | null; error: string | null }> {
  const supabase = await createClient();

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id, title, jd_hash, requirements, companies!inner ( name )')
    .eq('id', roleId)
    .eq('user_id', userId)
    .maybeSingle();

  if (roleError) return { matches: null, error: roleError.message };
  if (!role) return { matches: null, error: 'That role is not yours.' };

  const requirements = (role.requirements as Requirement[] | null) ?? [];
  if (requirements.length === 0) {
    return {
      matches: null,
      error: 'No requirements have been extracted from this description yet.',
    };
  }

  const { data: bank, error: bankError } = await supabase
    .from('evidence_items')
    .select('id, title, body, context, metrics, skills, strength')
    .eq('user_id', userId);

  if (bankError) return { matches: null, error: bankError.message };

  const items = (bank ?? []).map((item) => ({
    id: item.id as string,
    title: item.title as string,
    body: item.body as string,
    context: (item.context as string) ?? null,
    metrics: (item.metrics as string) ?? null,
    skills: (item.skills as string[]) ?? [],
    strength: item.strength as number,
  }));

  // An empty bank is an error, not an empty-context fallback: a map built
  // against nothing would read as a role you are wholly unqualified for.
  if (items.length === 0) {
    return {
      matches: null,
      error:
        'Your evidence bank is empty. Fill it in Material first — the map is only as good as it is.',
    };
  }

  const company = role.companies as unknown as { name: string } | null;
  const spend: SpendReport[] = [];
  const result = await matchRequirements(
    { apiKey, onSpend: (report) => spend.push(report) },
    {
      requirements,
      bank: shortlistEvidence(requirements, items),
      roleLabel: [company?.name, role.title as string].filter(Boolean).join(', '),
    },
  );
  await recordSessionSpend(userId, { module: 'jobs', operation: 'match-evidence' }, spend);

  if (!result.ok) return { matches: null, error: result.error };

  const { error: writeError } = await supabase
    .from('roles')
    .update({
      requirement_matches: result.matches,
      requirement_matches_at: new Date().toISOString(),
      requirement_matches_key: matchKey(role.jd_hash as string | null, items),
    })
    .eq('id', roleId)
    .eq('user_id', userId);

  if (writeError) return { matches: null, error: writeError.message };
  return { matches: result.matches, error: null };
}
