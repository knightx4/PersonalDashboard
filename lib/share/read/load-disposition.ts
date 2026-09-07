/**
 * The only module the shared page reads through.
 *
 * It takes a client and a token, calls one function, parses what comes back,
 * and arranges it for rendering. It has no network import to remove later
 * because it never had one -- see "The link is a window, never an engine" in
 * docs/SHARE-LINKS-SPEC.md, and the boundary in eslint.config.mjs that fails
 * the build if one appears.
 *
 * Everything the page shows is already in the database when she opens it. A
 * missing price stays missing here and renders blank; a missing photo stays
 * missing and renders as a placeholder. Neither is a reason to go looking.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

/**
 * The wire shape of share_page(). Parsed rather than cast, for the same reason
 * every other boundary in this app is parsed: the function is in a migration
 * and this is in TypeScript, and nothing but this schema notices when the two
 * drift apart.
 */
const groupSchema = z.object({
  groupKey: z.string(),
  familyKey: z.string().nullable(),
  familyLabel: z.string().nullable(),
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  imageUrl: z.string().nullable(),
  // Null means "not known", and stays null all the way to the renderer.
  unitPriceCents: z.number().int().nullable(),
  keepQty: z.number().int().nonnegative(),
  sellQty: z.number().int().nonnegative(),
  giveawayQty: z.number().int().nonnegative(),
  note: z.string().nullable(),
  answeredAt: z.string().nullable(),
});

const pageSchema = z.object({
  title: z.string(),
  intro: z.string().nullable(),
  kind: z.string(),
  canRespond: z.boolean(),
  groups: z.array(groupSchema),
});

export type ShareGroup = z.infer<typeof groupSchema> & {
  /** quantity less everything she has decided. */
  undecided: number;
};

export type ShareFamily = {
  key: string | null;
  label: string | null;
  groups: ShareGroup[];
};

export type SharePage = {
  title: string;
  intro: string | null;
  kind: string;
  canRespond: boolean;
  groups: ShareGroup[];
  /** The same groups, bucketed for rendering. Order is preserved from SQL. */
  families: ShareFamily[];
  totals: { products: number; units: number; decided: number };
};

/**
 * A single heading over a single game is noise, so a family of one renders
 * flat -- it joins the unfamilied bucket instead of getting a title of its own.
 */
function intoFamilies(groups: ShareGroup[]): ShareFamily[] {
  const ordered: ShareFamily[] = [];
  const byKey = new Map<string, ShareFamily>();
  const loose: ShareGroup[] = [];

  for (const group of groups) {
    if (!group.familyKey) {
      loose.push(group);
      continue;
    }
    const existing = byKey.get(group.familyKey);
    if (existing) {
      existing.groups.push(group);
      continue;
    }
    const family: ShareFamily = {
      key: group.familyKey,
      label: group.familyLabel ?? group.familyKey,
      groups: [group],
    };
    byKey.set(group.familyKey, family);
    ordered.push(family);
  }

  const kept: ShareFamily[] = [];
  for (const family of ordered) {
    if (family.groups.length > 1) kept.push(family);
    else loose.push(...family.groups);
  }

  if (loose.length > 0) {
    loose.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    kept.push({ key: null, label: null, groups: loose });
  }

  return kept;
}

export async function loadSharePage(
  supabase: SupabaseClient,
  token: string,
): Promise<SharePage | null> {
  // A token too short to be real is refused here as well as in SQL, so an
  // empty path segment never becomes a database round trip.
  if (!token || token.length < 24 || token.length > 128) return null;

  const { data, error } = await supabase.rpc('share_page', { p_token: token });
  if (error || data == null) return null;

  const parsed = pageSchema.safeParse(data);
  if (!parsed.success) return null;

  const groups: ShareGroup[] = parsed.data.groups.map((g) => ({
    ...g,
    undecided: Math.max(0, g.quantity - g.keepQty - g.sellQty - g.giveawayQty),
  }));

  return {
    title: parsed.data.title,
    intro: parsed.data.intro,
    kind: parsed.data.kind,
    canRespond: parsed.data.canRespond,
    groups,
    families: intoFamilies(groups),
    totals: {
      products: groups.length,
      units: groups.reduce((sum, g) => sum + g.quantity, 0),
      decided: groups.reduce((sum, g) => sum + g.keepQty + g.sellQty + g.giveawayQty, 0),
    },
  };
}

/** The shape share_respond() answers with. Same parse-don't-cast rule. */
export const respondResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    group: z.object({
      groupKey: z.string(),
      quantity: z.number().int(),
      keepQty: z.number().int(),
      sellQty: z.number().int(),
      giveawayQty: z.number().int(),
      undecided: z.number().int(),
      note: z.string().nullable(),
      answeredAt: z.string().nullable(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.enum(['read_only', 'rate_limited', 'unknown_group', 'negative', 'over_quantity']),
    quantity: z.number().int().optional(),
  }),
]);

export type RespondResult = z.infer<typeof respondResultSchema>;
