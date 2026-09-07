import { z } from 'zod';

/**
 * The shape a resolution comes back in, and the rules it has to satisfy.
 *
 * Split from the call itself so it can be tested without a network and without
 * a key -- the same split lib/jobs/evidence/propose-payload.ts makes, and for
 * the same reason: the validation is where the module's rules actually live,
 * so it is the part worth testing hardest.
 */

export const SOURCE_KINDS = [
  'article',
  'paper',
  'book',
  'chapter',
  'video',
  'course',
  'page',
] as const;

export const SOURCE_ACCESS = ['open', 'paywalled', 'purchase', 'library', 'unknown'] as const;

export const LOCATOR_KINDS = [
  'whole',
  'chapter',
  'section',
  'pages',
  'timestamp',
  'passage',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceAccess = (typeof SOURCE_ACCESS)[number];
export type LocatorKind = (typeof LOCATOR_KINDS)[number];

/** https only, matching the check constraint on the columns these land in. */
const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => value.startsWith('https://'), { message: 'https only' });

export const resolvedSourceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().max(300).nullable().optional(),
  kind: z.enum(SOURCE_KINDS).default('page'),
  year: z.number().int().min(1000).max(2200).nullable().optional(),
  canonical_url: httpsUrl.nullable().optional(),
  access: z.enum(SOURCE_ACCESS).default('unknown'),
  price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  page_count: z.number().int().positive().max(100_000).nullable().optional(),

  locator_kind: z.enum(LOCATOR_KINDS).default('whole'),
  locator_label: z.string().trim().max(300).nullable().optional(),
  page_from: z.number().int().positive().max(100_000).nullable().optional(),
  page_to: z.number().int().positive().max(100_000).nullable().optional(),
  /**
   * How the location was established. Required and non-empty, matching the
   * check constraint: the module may guess where a passage is, and may not
   * guess quietly.
   */
  locator_basis: z.string().trim().min(1).max(500),
  /**
   * Whether a table of contents or the document itself was actually seen. The
   * caller does not take this on trust for anything it can check -- see
   * `sanitiseResolution` below.
   */
  locator_verified: z.boolean().default(false),

  why: z.string().trim().max(500).nullable().optional(),
  not_found: z.boolean().default(false),
});

export type ResolvedSource = z.infer<typeof resolvedSourceSchema>;

/**
 * The rules applied after the model has spoken.
 *
 * Everything here is a case where a plausible answer would be wrong in a way
 * the database would happily store, so it is corrected rather than rejected --
 * a resolution with one bad field is still worth most of its value.
 */
export function sanitiseResolution(input: ResolvedSource): ResolvedSource {
  const out: ResolvedSource = { ...input };

  // A price only means something when somebody has to pay it, and the column
  // refuses the combination outright.
  if (out.access !== 'paywalled' && out.access !== 'purchase') {
    out.price_cents = null;
  }

  // Pages in the wrong order are a transposition, not a different range.
  if (out.page_from && out.page_to && out.page_from > out.page_to) {
    [out.page_from, out.page_to] = [out.page_to, out.page_from];
  }

  // A page range is a `pages` locator whatever it called itself, and a locator
  // claiming pages without any is a `whole`.
  if (out.page_from || out.page_to) {
    if (out.locator_kind === 'whole') out.locator_kind = 'pages';
  } else if (out.locator_kind === 'pages') {
    out.locator_kind = 'whole';
  }

  // `passage` means an anchor phrase was found in a fetched document. Nothing
  // at resolve time fetches anything, so the model cannot have one yet -- the
  // locate pass promotes a reading to `passage` when it verifies one.
  if (out.locator_kind === 'passage') {
    out.locator_kind = out.page_from ? 'pages' : 'section';
  }

  // Verification is a claim about work that was done, and no work was done
  // here: resolution searches, it does not fetch. Only the locate pass, which
  // holds the document, may set this.
  out.locator_verified = false;

  if (out.not_found) {
    out.canonical_url = null;
    out.access = 'unknown';
    out.price_cents = null;
  }

  return out;
}

/** Nothing usable came back. */
export function isEmptyResolution(resolved: ResolvedSource): boolean {
  return resolved.not_found && !resolved.canonical_url;
}
