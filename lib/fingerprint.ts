/**
 * Item fingerprints. Two of them, deliberately.
 *
 * Deduplication and similarity detection want opposite tradeoffs, so they do
 * not share one function:
 *
 *   strict -- order dedup. The same confirmation email arriving twice, or the
 *             same order landing in two connected inboxes. Precision is what
 *             matters; a false positive here deletes real data.
 *
 *   loose  -- the already-own and duplicate-purchase checks. Recall is what
 *             matters; a false positive costs the user a dismissible flag.
 *
 * The loose fingerprint drops merchant and variant on purpose. A single
 * merchant-scoped fingerprint silently breaks the product's headline feature:
 * the same headphones bought from Amazon in March and Best Buy in June would
 * never match, which is exactly the case where someone is least likely to
 * remember the earlier purchase.
 *
 * Loose matching is still imperfect, because merchants name the same product
 * differently ("Sony WH-1000XM5" vs "Sony WH1000XM5/B Wireless Headphones").
 * Trigram similarity closes part of that gap -- see OWNED_MATCH_SQL below.
 * Full product identity resolution needs a real UPC/GTIN catalog and is its
 * own project; do not attempt it in v1. The failure mode here is a missed
 * warning rather than a wrong one.
 */
import { createHash } from 'node:crypto';

/** Words that carry no identity signal and vary between merchants. */
const STOPWORDS = new Set(['the', 'a', 'and', 'with', 'for', 'new']);

/**
 * lowercase, strip punctuation, collapse whitespace, drop stopwords.
 *
 * Exported because the same normalization has to be applied to the trigram
 * comparison in SQL, and to anything a user types into search.
 */
export function normalize(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .normalize('NFKD')
    // strip diacritics so "crème" and "creme" agree
    .replace(/[\u0300-\u036f]/g, '')
    // punctuation to spaces, so "wh-1000xm5" and "wh 1000xm5" agree
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .join(' ');
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

/**
 * Order deduplication. Scoped to merchant and variant, so a size 10 black and
 * a size 11 black are distinct purchases rather than one deduped away.
 */
export function fingerprintStrict(input: {
  merchantSlug: string | null | undefined;
  name: string;
  variant?: string | null;
}): string {
  return sha1(
    [input.merchantSlug ?? '', normalize(input.name), normalize(input.variant)].join('|'),
  );
}

/**
 * Already-own and duplicate-purchase matching. No merchant, no variant, so the
 * same product bought from two different stores still matches.
 */
export function fingerprintLoose(name: string): string {
  return sha1(normalize(name));
}

/** Both at once, which is how they are always written. */
export function fingerprints(input: {
  merchantSlug: string | null | undefined;
  name: string;
  variant?: string | null;
}): { strict: string; loose: string } {
  return {
    strict: fingerprintStrict(input),
    loose: fingerprintLoose(input.name),
  };
}

/**
 * Threshold for cross-merchant trigram matching.
 *
 * This is a guess and is documented as one. Tune it against real data and
 * measure false positives specifically, because a wrong "you already own this"
 * is more annoying to a user than a missed one.
 */
export const TRIGRAM_SIMILARITY_THRESHOLD = 0.55;

/**
 * SQL for the already-own check: exact loose-fingerprint hits, plus trigram
 * near-matches on the normalized name.
 *
 * Scoped to the same category but deliberately NOT to the same merchant --
 * cross-merchant matching is the entire point.
 *
 * Kept here as a string rather than in a query file so the threshold, the
 * normalization and the fingerprint definition stay in one place.
 */
export const OWNED_MATCH_SQL = `
  select ii.id, ii.name, ii.variant, ii.image_url, ii.acquired_at, ii.cost_cents,
         case
           when ii.fingerprint_loose = $2 then 1.0
           else similarity(ii.name, $3)
         end as match_score
  from inventory_items ii
  where ii.user_id = $1
    and ii.status = 'owned'
    and (
      ii.fingerprint_loose = $2
      or ($4::uuid is not null and ii.category_id = $4::uuid
          and similarity(ii.name, $3) >= ${TRIGRAM_SIMILARITY_THRESHOLD})
    )
  order by match_score desc
  limit 10
`;

/** Positional parameters for {@link OWNED_MATCH_SQL}, in order. */
export function ownedMatchParams(input: {
  userId: string;
  name: string;
  categoryId: string | null;
}): [string, string, string, string | null] {
  return [input.userId, fingerprintLoose(input.name), input.name, input.categoryId];
}
