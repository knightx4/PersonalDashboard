import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The life areas on the Insights tab (plan #2629.5): the row of area chips
 * above the deck, and the line under it naming the areas no insight is about
 * yet. Areas are the person's Goals areas (goals.areas); an insight points at
 * one through you.insights.area_id (migrations-you/0036).
 */

export type LifeArea = { id: string; name: string };

/** One chip in the row: an area the cards are about, and how many wait in the deck. */
export type AreaChip = LifeArea & { count: number };

type Tagged = { areaId: string | null; areaName: string | null };

/**
 * The areas the cards span, each with the number of cards waiting in the deck
 * about it. They are ordered by how many cards are about each, marked or not,
 * then by name, so marking a card never moves a chip. An area whose cards have all been
 * marked stays with a count of none, so a chosen chip does not vanish from
 * under the finger. Cards with no area, or whose area is gone, count under
 * All only.
 */
export function areaChips(all: readonly Tagged[], waiting: readonly Tagged[]): AreaChip[] {
  const chips = new Map<string, AreaChip & { total: number }>();
  for (const insight of all) {
    if (!insight.areaId || !insight.areaName) continue;
    const chip = chips.get(insight.areaId) ?? { id: insight.areaId, name: insight.areaName, count: 0, total: 0 };
    chip.total += 1;
    chips.set(insight.areaId, chip);
  }
  for (const insight of waiting) {
    const chip = insight.areaId ? chips.get(insight.areaId) : undefined;
    if (chip) chip.count += 1;
  }
  return [...chips.values()]
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map(({ id, name, count }) => ({ id, name, count }));
}

/** The person's open areas that no insight is about yet, in their own order. */
export function uncoveredAreas(areas: readonly LifeArea[], insights: readonly Tagged[]): LifeArea[] {
  const covered = new Set(insights.map((insight) => insight.areaId).filter(Boolean));
  return areas.filter((area) => !covered.has(area.id));
}

/** "Health", "Health and Money", "Health, Money and Home". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The person's areas that are not archived, in the order they keep them on Goals. */
export async function listOpenAreas(client: YouSupabaseClient, userId: string): Promise<LifeArea[]> {
  const { data, error } = await client
    .schema('goals')
    .from('areas')
    .select('id, name')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('position', { ascending: true });
  if (error) throw new Error(`Reading your areas failed: ${error.message}`);
  return ((data ?? []) as LifeArea[]).map((row) => ({ id: row.id, name: row.name }));
}
