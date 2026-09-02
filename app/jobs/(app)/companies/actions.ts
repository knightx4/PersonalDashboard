'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import {
  createWikidataCompanyProvider,
  type WikidataCompany,
} from '@/lib/jobs/enrich/wikidata';
import {
  describePatch,
  proposedFields,
  rankCandidates,
  type CompanyPatch,
} from '@/lib/jobs/enrich/company';
import { fetchSiteIcon } from '@/lib/jobs/enrich/site-icon';
import { lookupCompanyOnline } from '@/lib/jobs/enrich/ai-company';
import { statusRank, type ApplicationStatus } from '@/lib/jobs/pipeline';

const updateSchema = z.object({
  companyId: z.string().uuid(),
  priority: z.enum(['target', 'interested', 'backup', 'passed']).optional(),
  research: z.string().optional(),
  domains: z.string().optional(),
  industry: z.string().optional(),
  hqLocation: z.string().optional(),
  careersUrl: z.string().optional(),
  linkedinUrl: z.string().optional(),
  website: z.string().optional(),
});

export async function updateCompany(
  input: z.input<typeof updateSchema>,
): Promise<{ error: string | null }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.data.priority) patch.priority = parsed.data.priority;
  if (parsed.data.research !== undefined) patch.research = parsed.data.research || null;
  if (parsed.data.industry !== undefined) patch.industry = parsed.data.industry || null;
  if (parsed.data.hqLocation !== undefined) patch.hq_location = parsed.data.hqLocation || null;
  if (parsed.data.careersUrl !== undefined) patch.careers_url = parsed.data.careersUrl || null;
  if (parsed.data.linkedinUrl !== undefined) patch.linkedin_url = parsed.data.linkedinUrl || null;
  if (parsed.data.website !== undefined) patch.website = parsed.data.website || null;
  if (parsed.data.domains !== undefined) {
    // Domains drive email linking, so they are normalised rather than trusted:
    // a stray "https://" here means mail from that company never links.
    patch.domains = parsed.data.domains
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
      .filter((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(entry));
  }

  const { error } = await supabase
    .from('companies')
    .update(patch)
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  revalidatePath('/jobs/companies');
  return { error: null };
}

const lookupSchema = z.object({ companyId: z.string().uuid() });

export interface EnrichmentProposal {
  wikidataId: string;
  label: string;
  description: string | null;
  /** True when the entity's own site matches a domain already on the record. */
  verified: boolean;
  /** Human-readable list of what applying would fill in. */
  changes: string[];
  /** Empty when there is nothing left to fill. */
  hasChanges: boolean;
}

/**
 * Look the company up, and report what could be filled in — without writing.
 *
 * Split from the write on purpose. A name search returns the wrong Ramp often
 * enough that applying automatically would quietly put a slope's Wikipedia
 * summary on a payments company, and you would never know it had happened
 * because you did not type it. The website check catches most of that, and the
 * confirm step catches the rest.
 */
export async function proposeCompanyEnrichment(
  input: z.input<typeof lookupSchema>,
): Promise<{ proposal: EnrichmentProposal | null; error: string | null }> {
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return { proposal: null, error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: company, error } = await supabase
    .from('companies')
    .select(COMPANY_ENRICH_COLUMNS)
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { proposal: null, error: error.message };
  if (!company) return { proposal: null, error: 'That company is not on your list.' };

  try {
    const provider = createWikidataCompanyProvider();
    const candidates = await provider.searchCompanies(company.name as string);
    const [best] = rankCandidates(candidates, {
      name: company.name as string,
      domains: (company.domains as string[] | null) ?? [],
      website: company.website as string | null,
      careersUrl: company.careers_url as string | null,
    });

    if (!best) {
      return {
        proposal: null,
        error:
          'Nothing on Wikidata matches that name. Smaller and younger companies are usually not there — fill the details in by hand.',
      };
    }

    const patch = await buildPatch(best.company, company);

    return {
      proposal: {
        wikidataId: best.company.wikidataId,
        label: best.company.label,
        description: best.company.description,
        verified: best.verified,
        changes: describePatch(patch),
        hasChanges: Object.keys(patch).length > 0,
      },
      error: null,
    };
  } catch (err) {
    // A provider outage is not the user's problem to debug.
    console.error('company enrichment lookup failed', {
      name: err instanceof Error ? err.name : 'unknown',
    });
    return { proposal: null, error: 'Could not reach Wikidata just now. Try again in a moment.' };
  }
}

const applySchema = lookupSchema.extend({ wikidataId: z.string().regex(/^Q\d+$/) });

/**
 * Write the confirmed lookup, filling blanks only.
 *
 * Re-fetches rather than trusting a patch round-tripped through the browser:
 * the client sends an entity id, and everything written is derived here from
 * that entity and from what the row currently holds.
 */
export async function applyCompanyEnrichment(
  input: z.input<typeof applySchema>,
): Promise<{ applied: string[]; error: string | null }> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { applied: [], error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: company, error } = await supabase
    .from('companies')
    .select(COMPANY_ENRICH_COLUMNS)
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { applied: [], error: error.message };
  if (!company) return { applied: [], error: 'That company is not on your list.' };

  let patch;
  try {
    const provider = createWikidataCompanyProvider();
    const entities = await provider.loadEntities([parsed.data.wikidataId]);
    const entity = entities.get(parsed.data.wikidataId);
    if (!entity) return { applied: [], error: 'That Wikidata entry is no longer a company.' };
    patch = await buildPatch(entity, company);
  } catch (err) {
    console.error('company enrichment apply failed', {
      name: err instanceof Error ? err.name : 'unknown',
    });
    return { applied: [], error: 'Could not reach Wikidata just now. Try again in a moment.' };
  }

  if (Object.keys(patch).length === 0) {
    return { applied: [], error: null };
  }

  const { error: writeError } = await supabase
    .from('companies')
    .update(patch)
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id);

  if (writeError) return { applied: [], error: writeError.message };

  // The detail page is where the button was pressed, so it is the page that
  // has to change. Revalidating only the list left the fields exactly as they
  // were until a manual reload.
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/companies');
  return { applied: describePatch(patch), error: null };
}

export interface AiEnrichmentProposal {
  website: string | null;
  summary: string | null;
  sources: Array<{ title: string | null; url: string }>;
  /** What applying would fill in — empty when both fields are already set. */
  changes: string[];
  hasChanges: boolean;
}

/**
 * The AI counterpart to the Wikidata lookup, for the companies too small or
 * too new to have an encyclopedia entry. Same propose-then-apply shape: a
 * search result is shown before it lands, and only ever fills blanks.
 */
export async function proposeAiCompanyEnrichment(
  input: z.input<typeof lookupSchema>,
): Promise<{ proposal: AiEnrichmentProposal | null; error: string | null }> {
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return { proposal: null, error: parsed.error.issues[0].message };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { proposal: null, error: 'AI lookups are not configured.' };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: company, error } = await supabase
    .from('companies')
    .select('id, name, domains, website, careers_url, industry, hq_location, research')
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { proposal: null, error: error.message };
  if (!company) return { proposal: null, error: 'That company is not on your list.' };

  const hints =
    [
      ((company.domains as string[] | null) ?? []).join(', ') || null,
      company.careers_url ? `careers page ${company.careers_url}` : null,
      company.industry as string | null,
      company.hq_location ? `based in ${company.hq_location}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join('; ') || null;

  const result = await lookupCompanyOnline({ apiKey }, { name: company.name as string, hints });
  if (!result.ok) return { proposal: null, error: result.error };

  const changes: string[] = [];
  if (!company.website && result.website) changes.push(`Homepage: ${result.website}`);
  if (!company.research && result.summary) changes.push('Research notes: a short summary');

  return {
    proposal: {
      website: result.website,
      summary: result.summary,
      sources: result.sources,
      changes,
      hasChanges: changes.length > 0,
    },
    error: null,
  };
}

const aiApplySchema = lookupSchema.extend({
  website: z.string().url().nullable(),
  summary: z.string().nullable(),
});

/**
 * Write what the AI lookup found, filling blanks only — re-checked against
 * the row's current state rather than the proposal, in case it changed by
 * hand between propose and apply.
 */
export async function applyAiCompanyEnrichment(
  input: z.input<typeof aiApplySchema>,
): Promise<{ applied: string[]; error: string | null }> {
  const parsed = aiApplySchema.safeParse(input);
  if (!parsed.success) return { applied: [], error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data: company, error } = await supabase
    .from('companies')
    .select('id, website, research')
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { applied: [], error: error.message };
  if (!company) return { applied: [], error: 'That company is not on your list.' };

  const patch: Record<string, unknown> = {};
  const applied: string[] = [];
  if (!company.website && parsed.data.website) {
    patch.website = parsed.data.website;
    applied.push('Homepage');
  }
  if (!company.research && parsed.data.summary) {
    patch.research = parsed.data.summary;
    applied.push('Research notes');
  }

  if (Object.keys(patch).length === 0) return { applied: [], error: null };

  const { error: writeError } = await supabase
    .from('companies')
    .update(patch)
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id);

  if (writeError) return { applied: [], error: writeError.message };

  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/companies');
  return { applied, error: null };
}

const mergeRolesSchema = z.object({
  companyId: z.string().uuid(),
  survivorRoleId: z.string().uuid(),
  mergedRoleIds: z.array(z.string().uuid()).min(1),
});

/**
 * Tables that hang off one specific application rather than the role as a
 * whole. Consolidating duplicate applications means moving every one of
 * these onto the survivor before the loser can be deleted, or its history —
 * events, interviews, attachments — would go with it.
 */
const APPLICATION_CHILD_TABLES = [
  'application_events',
  'application_answers',
  'attachments',
  'contact_touches',
  'cover_letters',
  'interviews',
  'message_link_dismissals',
  'notes',
] as const;

/**
 * Roles being merged are the same posting, so their applications are the same
 * application, not separate attempts. Keep the one furthest along — ties
 * broken by whichever is older — move every other one's history onto it, and
 * delete the rest. `apps` must already include every application on the
 * survivor and every merged role.
 */
async function consolidateApplications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  survivorRoleId: string,
  apps: Array<{
    id: string;
    role_id: string;
    attempt: number;
    status: string;
    status_manual_override: string | null;
    created_at: string;
  }>,
): Promise<{ error: string | null }> {
  if (apps.length === 0) return { error: null };

  const target = apps.reduce((best, app) => {
    const appRank = statusRank(app.status as ApplicationStatus);
    const bestRank = statusRank(best.status as ApplicationStatus);
    if (appRank !== bestRank) return appRank > bestRank ? app : best;
    return new Date(app.created_at) < new Date(best.created_at) ? app : best;
  });

  const losers = apps.filter((app) => app.id !== target.id);
  let overrideToApply: string | null = null;

  for (const loser of losers) {
    for (const table of APPLICATION_CHILD_TABLES) {
      const { error } = await supabase
        .from(table)
        .update({ application_id: target.id })
        .eq('application_id', loser.id);
      if (error) return { error: error.message };
    }
    // A manual override is a deliberate human decision — keep it rather than
    // silently dropping it because it happened to be on the losing row.
    if (!target.status_manual_override && !overrideToApply && loser.status_manual_override) {
      overrideToApply = loser.status_manual_override;
    }
    const { error } = await supabase.from('applications').delete().eq('id', loser.id);
    if (error) return { error: error.message };
  }

  if (overrideToApply) {
    const { error } = await supabase
      .from('applications')
      .update({ status_manual_override: overrideToApply })
      .eq('id', target.id);
    if (error) return { error: error.message };
  }

  if (target.role_id !== survivorRoleId || target.attempt !== 1) {
    const { error } = await supabase
      .from('applications')
      .update({ role_id: survivorRoleId, attempt: 1 })
      .eq('id', target.id);
    if (error) return { error: error.message };
  }

  return { error: null };
}

/**
 * Fold one or more duplicate role rows into the survivor. They are the same
 * posting, so their applications are consolidated into one rather than piled
 * up as separate attempts — see consolidateApplications.
 */
export async function mergeRoles(
  input: z.input<typeof mergeRolesSchema>,
): Promise<{ error: string | null }> {
  const parsed = mergeRolesSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not a mergeable selection.' };
  const { companyId, survivorRoleId, mergedRoleIds } = parsed.data;
  if (mergedRoleIds.includes(survivorRoleId)) {
    return { error: 'Pick a different role to merge into.' };
  }

  const user = await requireUser();
  const supabase = await createClient();

  // RLS would block a cross-owner or cross-company row silently rather than
  // explain why nothing moved, so it is checked here for a real message.
  const { data: involved } = await supabase
    .from('roles')
    .select('id, company_id')
    .eq('user_id', user.id)
    .in('id', [survivorRoleId, ...mergedRoleIds]);

  if ((involved ?? []).length !== mergedRoleIds.length + 1) {
    return { error: 'One of those roles no longer exists.' };
  }
  if ((involved ?? []).some((role) => role.company_id !== companyId)) {
    return { error: 'Roles can only be merged within the same company.' };
  }

  const { data: apps, error: appsError } = await supabase
    .from('applications')
    .select('id, role_id, attempt, status, status_manual_override, created_at')
    .in('role_id', [survivorRoleId, ...mergedRoleIds]);
  if (appsError) return { error: appsError.message };

  const { error: consolidateError } = await consolidateApplications(
    supabase,
    survivorRoleId,
    apps ?? [],
  );
  if (consolidateError) return { error: consolidateError };

  for (const mergedRoleId of mergedRoleIds) {
    const { error: notesError } = await supabase
      .from('notes')
      .update({ role_id: survivorRoleId })
      .eq('role_id', mergedRoleId);
    if (notesError) return { error: notesError.message };

    const { error: attachmentsError } = await supabase
      .from('attachments')
      .update({ role_id: survivorRoleId })
      .eq('role_id', mergedRoleId);
    if (attachmentsError) return { error: attachmentsError.message };

    const { error: deleteError } = await supabase.from('roles').delete().eq('id', mergedRoleId);
    if (deleteError) return { error: deleteError.message };
  }

  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/companies');
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/roles');
  return { error: null };
}

const COMPANY_ENRICH_COLUMNS =
  'id, name, domains, website, careers_url, industry, hq_location, headcount_band, stage, logo_url, linkedin_url';

/**
 * The fields a lookup would fill, with the company's own site consulted only
 * when Wikidata has no logo — one extra request, and only when it buys
 * something.
 */
async function buildPatch(
  entity: WikidataCompany,
  company: Record<string, unknown>,
): Promise<CompanyPatch> {
  const existing = {
    industry: company.industry as string | null,
    hq_location: company.hq_location as string | null,
    headcount_band: company.headcount_band as string | null,
    stage: company.stage as string | null,
    logo_url: company.logo_url as string | null,
    linkedin_url: company.linkedin_url as string | null,
    website: company.website as string | null,
  };

  let siteIcon: string | null = null;
  if (!existing.logo_url && !entity.logoUrl) {
    const domain =
      entity.websiteDomain ?? ((company.domains as string[] | null) ?? [])[0] ?? null;
    if (domain) siteIcon = await fetchSiteIcon(domain);
  }

  return proposedFields(entity, existing, { logoUrl: siteIcon });
}
