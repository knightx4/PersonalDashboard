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

const updateSchema = z.object({
  companyId: z.string().uuid(),
  priority: z.enum(['target', 'interested', 'backup', 'passed']).optional(),
  research: z.string().optional(),
  domains: z.string().optional(),
  industry: z.string().optional(),
  hqLocation: z.string().optional(),
  careersUrl: z.string().optional(),
  linkedinUrl: z.string().optional(),
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

  revalidatePath('/jobs/companies');
  return { applied: describePatch(patch), error: null };
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
