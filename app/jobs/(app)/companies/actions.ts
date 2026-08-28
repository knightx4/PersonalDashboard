'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';

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
