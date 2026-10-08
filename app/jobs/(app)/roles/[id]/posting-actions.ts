'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { extractRequirements, type Requirement } from '@/lib/jobs/jd/requirements';
import { matchRequirements } from '@/lib/jobs/evidence/match';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { matchKey, type RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import { shortlistEvidence } from '@/lib/jobs/evidence/shortlist';

/**
 * The requirement match.
 *
 * Triggered by a click rather than computed on render: it costs a model call,
 * and a page you visit six times while deciding should not cost six. The
 * stored key is the other half of that — a match already computed against this
 * description and this bank is returned as it stands, and re-running is only
 * offered once one of the two has changed.
 */
const matchSchema = z.object({ roleId: z.string().uuid() });

/**
 * Read the description again and rebuild the requirement map from it.
 *
 * The map used to be built only where a description was written -- pasting
 * one, or the nightly board lookup finding one -- which is right until the
 * parser improves or the description was one it could not read. Then the role
 * sits there with six thousand characters of posting and an empty map, and
 * nothing on the page will try again. This is the button that tries again.
 *
 * It is not a match: matching costs a model call and is asked for separately.
 * This is the free half, and it says how many lines it found so that a
 * description the parser genuinely cannot read says so rather than looking
 * like a button that did nothing.
 */
// latency: pending
export async function rebuildRequirementMap(
  input: z.input<typeof matchSchema>,
): Promise<{ requirements: Requirement[] | null; error: string | null }> {
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { requirements: null, error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id, jd_text')
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (roleError) return { requirements: null, error: roleError.message };
  if (!role) return { requirements: null, error: 'That role is not yours.' };

  const text = ((role.jd_text as string | null) ?? '').trim();
  if (!text) {
    return { requirements: null, error: 'There is no description to read.' };
  }

  const requirements = extractRequirements(text);

  const { error } = await supabase
    .from('roles')
    .update({
      requirements,
      requirements_extracted_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (error) return { requirements: null, error: error.message };

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  return { requirements, error: null };
}

// latency: pending
export async function matchRoleRequirements(
  input: z.input<typeof matchSchema>,
): Promise<{ matches: RequirementMatch[] | null; error: string | null }> {
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { matches: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { matches: null, error: 'Matching is not configured.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id, title, jd_hash, requirements, companies!inner ( name )')
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id)
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
    .eq('user_id', user.id);

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
        'Your evidence bank is empty. Fill it in Settings first — the map is only as good as it is.',
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
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'match-evidence' }, spend);

  if (!result.ok) return { matches: null, error: result.error };

  const { error: writeError } = await supabase
    .from('roles')
    .update({
      requirement_matches: result.matches,
      requirement_matches_at: new Date().toISOString(),
      requirement_matches_key: matchKey(role.jd_hash as string | null, items),
    })
    .eq('id', parsed.data.roleId)
    .eq('user_id', user.id);

  if (writeError) return { matches: null, error: writeError.message };

  revalidatePath(`/jobs/roles/${parsed.data.roleId}`);
  return { matches: result.matches, error: null };
}
