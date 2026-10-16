/**
 * Offering a lens for a vault theme no lens covers (plan #2138.14;
 * docs/LEARN-LEVELS-SPEC.md, "Lenses: subjects and goals").
 *
 * At the end of a practice run, levels the person missed on topics tied to a
 * vault theme are the sign they are learning something no subject or goal
 * asked for. A topic is tied to a theme when the topic carries the field the
 * theme is placed in (learn.theme_fields). A theme is covered when some lens
 * already holds a topic in that field. The offer is a lens named for the
 * theme, with each missed topic at the highest level missed on it.
 *
 * Pure: the rows come from lib/learn/levels/theme-offer-store.ts.
 */

import type { RunCell } from '@/lib/learn/levels/run';

export type OfferTheme = { id: string; name: string; fieldId: string; strength: number };

export type ThemeOffer = {
  themeId: string;
  themeName: string;
  /** The topics the lens would hold, each at the highest level missed on it. */
  topics: Array<{ topicId: string; name: string; level: number }>;
};

export function themeOffers(input: {
  missed: readonly RunCell[];
  /** Fields each topic carries. */
  topicFields: ReadonlyMap<string, readonly string[]>;
  /** Themes placed in a field, with their strength in the vault. */
  themes: readonly OfferTheme[];
  /** Topics already on any lens. */
  lensTopics: ReadonlySet<string>;
  /** Themes whose offer was declined. */
  declined: ReadonlySet<string>;
  /** A topic's ceiling, to keep a target within it. */
  ceilings: ReadonlyMap<string, number>;
}): ThemeOffer[] {
  const missedBy = new Map<string, { name: string; level: number }>();
  for (const c of input.missed) {
    const was = missedBy.get(c.topicId);
    if (!was || c.level > was.level) missedBy.set(c.topicId, { name: c.topicName, level: c.level });
  }
  if (missedBy.size === 0) return [];

  const coveredFields = new Set<string>();
  for (const topicId of input.lensTopics) for (const f of input.topicFields.get(topicId) ?? []) coveredFields.add(f);

  const claimed = new Set<string>();
  const out: ThemeOffer[] = [];
  const themes = [...input.themes].sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
  for (const theme of themes) {
    if (input.declined.has(theme.id) || coveredFields.has(theme.fieldId)) continue;
    const topics = [...missedBy]
      .filter(([id]) => !claimed.has(id) && (input.topicFields.get(id) ?? []).includes(theme.fieldId))
      .map(([topicId, m]) => ({
        topicId,
        name: m.name,
        level: Math.max(1, Math.min(input.ceilings.get(topicId) ?? 10, m.level)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (topics.length === 0) continue;
    for (const t of topics) claimed.add(t.topicId);
    out.push({ themeId: theme.id, themeName: theme.name, topics });
  }
  return out;
}
