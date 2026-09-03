/**
 * Proposing which things belong together.
 *
 * The form reads better with "Monopoly" over the six Monopolies than with six
 * unrelated cards spelling out the word six times. Families are what do that,
 * and this suggests them.
 *
 * Suggestions, not decisions. Every proposal here is written as an unconfirmed
 * `inventory_item_families` row and grouped only once a person says yes,
 * because the hard cases are genuinely judgement calls: "Ticket to Ride:
 * Europe" is a standalone game that happens to be named after another one, and
 * no heuristic settles that. Rejecting one is a tombstone, so the answer
 * sticks and the suggester does not propose it again next week.
 *
 * ## Why this is title clustering and not BoardGameGeek
 *
 * BGG publishes the real answer -- every expansion carries a
 * `boardgameexpansion` link back to its base -- and the spec called for using
 * it. It is deliberately not used, because it cannot be: lib/games/providers/bgg.ts
 * says in its own header that BGG refuses requests from datacenter IPs, which
 * is why Wikidata exists in that directory at all, and Wikidata does not carry
 * the expansion relation. A fetcher for it would be code that returns 401 from
 * every deployment and passes only on a laptop.
 *
 * The clustering below reaches the same answer for the shelf in hand, because
 * publishers name expansions after their base game on the box: the signal BGG
 * would confirm is already in the title. When a route to those links opens up
 * -- an API key, a proxy, a Wikidata property -- it belongs here as a second
 * source with a higher confidence, alongside this rather than replacing it.
 */
import { cleanGameTitle } from '@/lib/games/clean-title';

export type FamilyRole = 'base' | 'expansion' | 'edition' | 'accessory' | 'member';

export type FamilyCandidate = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
};

export type FamilySuggestion = {
  slug: string;
  name: string;
  members: Array<{
    inventoryItemId: string;
    role: FamilyRole;
    confidence: number;
  }>;
};

/** Trailing noise that is never part of a family's name. */
const TRAILING_EXPANSION = /\s*(?:-|–|—)?\s*\b(?:expansion|exp)\b\s*\d*\s*$/i;

const ACCESSORY_WORDS =
  /\b(?:insert|organizer|organiser|sleeves?|playmat|storage|upgrade kit|replacement|spare parts?)\b/i;
const EXPANSION_WORDS = /\b(?:expansion|exp\.?|scenario pack|promo pack)\b/i;
const EDITION_WORDS =
  /\b(?:edition|anniversary|deluxe|collector'?s?|big box|legacy|travel|junior|classic)\b/i;

function titleOf(item: FamilyCandidate): string {
  return cleanGameTitle(item.shortName?.trim() || item.name);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The part before a colon or dash, with any "expansion 2" tail removed. */
function rootOf(title: string): { root: string; suffix: string } | null {
  const split = title.match(/^(.{3,}?)\s*[:–—]\s*(.+)$/);
  if (!split) return null;
  const root = split[1]!.replace(TRAILING_EXPANSION, '').trim();
  if (normalized(root).length < 3) return null;
  return { root, suffix: split[2]!.trim() };
}

function roleFor(title: string, suffix: string | null, isBase: boolean): FamilyRole {
  if (isBase) return 'base';
  const blob = suffix ?? title;
  if (ACCESSORY_WORDS.test(blob)) return 'accessory';
  if (EXPANSION_WORDS.test(blob)) return 'expansion';
  if (EDITION_WORDS.test(blob)) return 'edition';
  return 'member';
}

/**
 * Group a shelf into proposed families.
 *
 * Two signals, and no third:
 *
 *   colon    "Catan: Seafarers" names its own family. This is the strong one --
 *            the publisher put the relationship in the title on purpose.
 *   prefix   a title that starts with a family name already established by the
 *            first signal joins it, so "Monopoly Junior" lands under the
 *            "Monopoly" that "Monopoly: Star Wars" created.
 *
 * There is deliberately no bare shared-first-word rule. It would put "The Game
 * of Life" and "The Game of Thrones" in one family, and a suggestion that
 * confidently wrong costs more trust than the grouping is worth.
 */
export function suggestFamilies(items: readonly FamilyCandidate[]): FamilySuggestion[] {
  type Draft = {
    slug: string;
    name: string;
    members: Map<string, { inventoryItemId: string; role: FamilyRole; confidence: number }>;
  };

  const drafts = new Map<string, Draft>();
  const titles = items.map((item) => ({ item, title: titleOf(item) }));

  // Pass one: colons establish the families.
  for (const { item, title } of titles) {
    const parsed = rootOf(title);
    if (!parsed) continue;

    const slug = slugify(parsed.root);
    if (!slug) continue;

    const draft = drafts.get(slug) ?? { slug, name: parsed.root, members: new Map() };
    draft.members.set(item.inventoryItemId, {
      inventoryItemId: item.inventoryItemId,
      role: roleFor(title, parsed.suffix, false),
      confidence: 0.9,
    });
    drafts.set(slug, draft);
  }

  if (drafts.size === 0) return [];

  // Pass two: everything else joins a family it is named after.
  for (const { item, title } of titles) {
    if ([...drafts.values()].some((d) => d.members.has(item.inventoryItemId))) continue;

    const normal = normalized(title);
    let best: { draft: Draft; confidence: number; isBase: boolean } | null = null;

    for (const draft of drafts.values()) {
      const root = normalized(draft.name);
      if (normal === root) {
        best = { draft, confidence: 0.95, isBase: true };
        break;
      }
      // Word boundary, so "Catan" does not swallow "Catanzaro".
      if (normal.startsWith(`${root} `)) {
        // Longest root wins: "Ticket to Ride Europe" belongs to "Ticket to
        // Ride", not to a shorter family that happens to also prefix it.
        if (!best || root.length > normalized(best.draft.name).length) {
          best = { draft, confidence: 0.75, isBase: false };
        }
      }
    }

    if (!best) continue;
    best.draft.members.set(item.inventoryItemId, {
      inventoryItemId: item.inventoryItemId,
      role: roleFor(title, null, best.isBase),
      confidence: best.confidence,
    });
  }

  // Pass three: dissolve the families of one.
  //
  // "Ticket to Ride Europe: 1912" names a family that nothing else joins, and
  // dropping it as a singleton would strand the item with no grouping at all
  // even though a broader "Ticket to Ride" is sitting right there. So a lone
  // member is re-homed into the longest family whose name its title starts
  // with, and only then is the empty draft discarded.
  const titleById = new Map(titles.map(({ item, title }) => [item.inventoryItemId, title]));
  const survivors = [...drafts.values()].filter((d) => d.members.size > 1);

  for (const draft of drafts.values()) {
    if (draft.members.size !== 1) continue;
    const [member] = [...draft.members.values()];
    if (!member) continue;
    const normal = normalized(titleById.get(member.inventoryItemId) ?? '');

    let host: Draft | null = null;
    for (const candidate of survivors) {
      if (candidate === draft) continue;
      const root = normalized(candidate.name);
      if (!normal.startsWith(`${root} `) && normal !== root) continue;
      if (!host || root.length > normalized(host.name).length) host = candidate;
    }

    if (host) {
      host.members.set(member.inventoryItemId, { ...member, confidence: 0.7 });
      draft.members.clear();
    }
  }

  // A family of one is a heading over a single game, which is noise.
  return [...drafts.values()]
    .filter((draft) => draft.members.size > 1)
    .map((draft) => ({
      slug: draft.slug,
      name: draft.name,
      members: [...draft.members.values()].sort((a, b) => {
        const order: FamilyRole[] = ['base', 'edition', 'expansion', 'accessory', 'member'];
        return order.indexOf(a.role) - order.indexOf(b.role);
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
