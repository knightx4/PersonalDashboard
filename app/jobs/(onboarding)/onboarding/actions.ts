'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { markOnboardingComplete } from '@/lib/jobs/onboarding';
import { domainFromUrl, slugify } from '@/lib/jobs/slug';
import { normalizeTimeZone } from '@/lib/core/timezone';

export interface OnboardingState {
  error?: string;
}

const welcomeSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .optional()
    // Validated here rather than trusted, because this is a free-text field
    // whose value is handed straight to Intl on every page that shows a date.
    // "ET" got stored once and took the review queue down with a 500.
    .refine((value) => !value || normalizeTimeZone(value) !== null, {
      message:
        'That is not a timezone name. Use something like Europe/London or America/New_York.',
    }),
  targetTitles: z.string().trim().optional(),
  searchStartedOn: z.string().optional(),
});

export async function saveWelcome(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = welcomeSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    timezone: formData.get('timezone') ?? '',
    targetTitles: formData.get('targetTitles') ?? '',
    searchStartedOn: formData.get('searchStartedOn') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (parsed.data.displayName) patch.display_name = parsed.data.displayName;
  if (parsed.data.timezone) patch.timezone = normalizeTimeZone(parsed.data.timezone);
  if (parsed.data.searchStartedOn) patch.search_started_on = parsed.data.searchStartedOn;
  if (parsed.data.targetTitles) {
    patch.target_titles = parsed.data.targetTitles
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (Object.keys(patch).length > 0) {
    await supabase.from('profiles').update(patch).eq('id', user.id);
  }

  redirect('/jobs/onboarding?step=companies');
}

/**
 * Seed a few companies before the first inbox scan.
 *
 * This is not busywork. Linking scores a message against the companies you
 * track, and the second Gmail query — the one that catches direct recruiter
 * outreach at all — searches their domains. Starting with three to five means
 * the first backfill has something to match against instead of holding
 * everything for review.
 */
export async function saveCompanies(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const raw = String(formData.get('companies') ?? '').trim();
  const user = await requireUser();
  const supabase = await createClient();

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 25);

  for (const line of lines) {
    // "Ramp, ramp.com" or just "Ramp".
    const [namePart, domainPart] = line.split(',').map((part) => part.trim());
    if (!namePart) continue;
    const domain = domainFromUrl(domainPart) ?? domainPart?.toLowerCase() ?? null;

    await supabase.from('companies').insert({
      user_id: user.id,
      name: namePart,
      slug: slugify(namePart),
      domains: domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? [domain] : [],
    });
  }

  redirect('/jobs/onboarding?step=gmail');
}

export async function finishOnboarding(): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  await markOnboardingComplete(supabase, user.id);
  redirect('/jobs/today');
}
