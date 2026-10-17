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
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { statusRank, type ApplicationStatus } from '@/lib/jobs/pipeline';
import { slugify } from '@/lib/jobs/slug';
import { PERSPECTIVE_QUESTIONS } from '@/lib/jobs/companies/perspective';
import { ensureCompany } from '@/lib/jobs/companies/ensure';

/**
 * Add a company by name, from the Companies tab (note 8554f9d8). The same
 * company already on the list, by name or by the website given, is opened
 * instead of made twice. Returns the slug the page goes to.
 */
// latency: pending
export async function addCompany(input: {
  name: string;
  website?: string;
}): Promise<{ error: string | null; slug?: string }> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, 'Name the company.').max(200),
      website: z.string().trim().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const company = await ensureCompany(supabase, user.id, parsed.data.name, {
    website: parsed.data.website || null,
  });
  if (company.error) return { error: company.error };

  const { data } = await supabase.from('companies').select('slug').eq('id', company.id).eq('user_id', user.id).maybeSingle();
  revalidatePath('/jobs/companies');
  return { error: null, slug: (data?.slug as string | undefined) ?? slugify(parsed.data.name) };
}

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
  /** Answers on the Perspective tab, by question key; a blank one clears it. */
  perspective: z
    .object(
      Object.fromEntries(
        PERSPECTIVE_QUESTIONS.map((question) => [question.key, z.string().max(20_000).optional()]),
      ) as Record<(typeof PERSPECTIVE_QUESTIONS)[number]['key'], z.ZodOptional<z.ZodString>>,
    )
    .optional(),
});

// latency: pending
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
  const perspective = parsed.data.perspective ?? {};
  for (const question of PERSPECTIVE_QUESTIONS) {
    const answer = perspective[question.key];
    if (answer === undefined) continue;
    patch[question.column] = answer.trim() || null;
    patch.perspective_updated_at = new Date().toISOString();
  }
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
  revalidatePath('/jobs/companies/[slug]', 'page');
  return { error: null };
}

const renameSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1, 'A company needs a name.').max(120),
});

/**
 * Correct a company's name.
 *
 * Its own action rather than a field on `updateCompany`, because the name is
 * the one column that is not just a value: the slug is derived from it, the
 * slug is this company's URL, and `ensureCompany` matches on the slug when the
 * inbox meets this company again. Leaving the slug behind would mean the next
 * email from them quietly created a second company, so the slug moves with the
 * name and the caller is handed the new URL to go to.
 *
 * A name whose slug is already taken is refused by (user_id, slug) in the
 * database; it is checked first so the answer is a sentence rather than a
 * constraint violation.
 */
// latency: pending
export async function renameCompany(
  companyId: string,
  name: string,
): Promise<{ error: string | null; slug: string | null }> {
  const parsed = renameSchema.safeParse({ companyId, name });
  if (!parsed.success) return { error: parsed.error.issues[0].message, slug: null };

  const user = await requireUser();
  const supabase = await createClient();
  const slug = slugify(parsed.data.name);

  const { data: clash } = await supabase
    .from('companies')
    .select('id, name')
    .eq('user_id', user.id)
    .eq('slug', slug)
    .neq('id', parsed.data.companyId)
    .maybeSingle();

  if (clash) return { error: `You already have a company called ${clash.name}.`, slug: null };

  const { error } = await supabase
    .from('companies')
    .update({ name: parsed.data.name, slug })
    .eq('id', parsed.data.companyId)
    .eq('user_id', user.id);

  if (error) return { error: error.message, slug: null };

  revalidatePath('/jobs/companies');
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/pipeline');
  return { error: null, slug };
}

const mergeCompaniesSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
});

/**
 * Fold one company into another: the same employer recorded twice, such as
 * Heron and Heron Data.
 *
 * The work is one database function, `job_search.merge_companies`, so a merge
 * either moves everything or nothing. It reads which tables point at a company
 * from the foreign keys rather than from a list here, so a table added later
 * is carried along without this action changing. The merged company's slug
 * stops resolving, so the caller is handed the kept one's to go to.
 */
// latency: pending
export async function mergeCompanies(
  input: z.input<typeof mergeCompaniesSchema>,
): Promise<{ error: string | null; slug: string | null }> {
  const parsed = mergeCompaniesSchema.safeParse(input);
  if (!parsed.success) return { error: 'That is not a mergeable pair.', slug: null };
  if (parsed.data.keepId === parsed.data.mergeId) {
    return { error: 'Pick a different company to merge.', slug: null };
  }

  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('merge_companies', {
    p_keep: parsed.data.keepId,
    p_merge: parsed.data.mergeId,
  });
  if (error) return { error: error.message, slug: null };

  revalidatePath('/jobs/companies');
  revalidatePath('/jobs/companies/[slug]', 'page');
  revalidatePath('/jobs/roles/[id]', 'page');
  revalidatePath('/jobs/pipeline');
  revalidatePath('/jobs/contacts');
  return { error: null, slug: ((data as { kept_slug?: string } | null)?.kept_slug ?? null) };
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
// latency: pending
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
// latency: pending
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
// latency: pending
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

  const spend: SpendReport[] = [];
  const result = await lookupCompanyOnline(
    { apiKey, onSpend: (report) => spend.push(report) },
    { name: company.name as string, hints },
  );
  await recordSessionSpend(user.id, { module: 'jobs', operation: 'enrich-company' }, spend);
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
// latency: pending
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
 * The application a merge keeps: the one furthest along, ties broken by
 * whichever is older. Ranking status is lib/jobs/pipeline.ts's job, so it is
 * decided here and handed to the database.
 */
function keptApplication(
  apps: Array<{ id: string; status: string; created_at: string }>,
): string | null {
  if (apps.length === 0) return null;
  return apps.reduce((best, app) => {
    const appRank = statusRank(app.status as ApplicationStatus);
    const bestRank = statusRank(best.status as ApplicationStatus);
    if (appRank !== bestRank) return appRank > bestRank ? app : best;
    return new Date(app.created_at) < new Date(best.created_at) ? app : best;
  }).id;
}

/**
 * Fold one or more duplicate role rows into the survivor. They are the same
 * posting, so their applications become one, the one furthest along.
 *
 * The moving is `job_search.merge_roles`, in one transaction, and it reads
 * which tables to move from the foreign keys. This action used to move eight
 * tables from a list of its own while fourteen point at an application, so a
 * merge deleted the rest with the duplicate (migration 0058 says which).
 */
// latency: pending
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
    .select('id, status, created_at')
    .in('role_id', [survivorRoleId, ...mergedRoleIds]);
  if (appsError) return { error: appsError.message };

  const { error } = await supabase.rpc('merge_roles', {
    p_keep_role: survivorRoleId,
    p_merge_roles: mergedRoleIds,
    p_keep_application: keptApplication(
      (apps ?? []) as Array<{ id: string; status: string; created_at: string }>,
    ),
  });
  if (error) return { error: error.message };

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
