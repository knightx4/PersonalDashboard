import { detectPosting } from '@/lib/jobs/ats/detect';

/**
 * The recruiting platform a role is posted on (roles.posting_platform,
 * migration job_search 0081), typed by the person on the role page or given
 * to Dash's change_role. When none is typed, the posting link usually says:
 * `platformFromLink` reads it with the same detector the description lookup
 * uses.
 */

export const POSTING_PLATFORMS = [
  'ashby',
  'greenhouse',
  'lever',
  'workday',
  'icims',
  'smartrecruiters',
  'workable',
  'recruitee',
  'breezy',
  'bamboohr',
  'rippling',
  'taleo',
  'jobvite',
  'wellfound',
  'linkedin',
  'indeed',
  'in_house',
  'other',
] as const;

export type PostingPlatform = (typeof POSTING_PLATFORMS)[number];

export const POSTING_PLATFORM_LABELS: Record<PostingPlatform, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  icims: 'iCIMS',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  recruitee: 'Recruitee',
  breezy: 'Breezy',
  bamboohr: 'BambooHR',
  rippling: 'Rippling',
  taleo: 'Taleo',
  jobvite: 'Jobvite',
  wellfound: 'Wellfound',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  in_house: "In-house (the company's own site)",
  other: 'Other',
};

export function isPostingPlatform(value: unknown): value is PostingPlatform {
  return typeof value === 'string' && (POSTING_PLATFORMS as readonly string[]).includes(value);
}

/** The platform a posting link is on, or null when the link does not say. */
export function platformFromLink(url: string | null | undefined): PostingPlatform | null {
  if (!url?.trim()) return null;
  try {
    const vendor = detectPosting(url.trim()).vendor;
    return isPostingPlatform(vendor) && vendor !== 'other' ? vendor : null;
  } catch {
    return null;
  }
}

/** What the role page shows: the typed platform, else the one the link names, saying which. */
export function shownPlatform(
  typed: string | null | undefined,
  jdUrl: string | null | undefined,
): { label: string; fromLink: boolean } | null {
  if (isPostingPlatform(typed)) return { label: POSTING_PLATFORM_LABELS[typed], fromLink: false };
  const read = platformFromLink(jdUrl);
  return read ? { label: POSTING_PLATFORM_LABELS[read], fromLink: true } : null;
}
