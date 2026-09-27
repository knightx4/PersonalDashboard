/**
 * Which article sections a claim may be matched against.
 *
 * The section trial on #760 (docs/trials/2026-09-26-wikipedia-sections.md)
 * judged 72 candidates by hand. Sections under 300 characters were accepted 0
 * times in 13, and link lists (See also, External links and the like) came up
 * as close matches for almost every claim without teaching any of them. Urban
 * sprawl's 150-character "Characteristics" section scored 0.50 to 0.62 against
 * 11 of 13 unrelated Tell claims, above the Tell article's own sections. A
 * short section embeds as "an article about this subject" rather than as
 * anything it says, so it sits near everything in that subject.
 *
 * Such a section is still stored, so a reading already queued on one opens as
 * before. It is cut with `searchable` false, the embedding pass skips it, the
 * nearest-segment search leaves it out, and the database refuses it a vector
 * (`catalogue_segments_searchable_ck`, learn migration 0069).
 *
 * This is the one place the rule is written. The Wikipedia cutter applies it
 * to each section, `rankNearest` applies it again to what the index returns,
 * and the paragraph passages of #1132 use it to decide which sections get
 * passages at all. Migration 0069 restates it once in SQL to mark the sections
 * stored before it; a change here needs the same change made to the stored
 * rows.
 *
 * It applies to article sections only. A lecture's timed segments are cut to
 * a length by lib/learn/catalogue/segment.ts and are always searchable.
 */

/**
 * The shortest section worth matching, in characters of trimmed text.
 *
 * From the trial's numbers. nearest.ts re-exports it beside
 * `DEFAULT_MIN_SIMILARITY`, because both are thresholds set from one small
 * sample and both are expected to move once more material has been judged.
 * This module has no imports so the Wikipedia cutter can use it without
 * pulling in the embedding client.
 */
export const MIN_SEARCHABLE_SECTION_CHARS = 300;

/**
 * Headings whose section is a list of links or sources rather than prose.
 *
 * The five the trial named, plus the three other names Wikipedia uses for the
 * same list that appear in the live catalogue (Bibliography, Sources, Works
 * cited). Compared case-insensitively against the whole heading, so
 * "Primary sources" or "Cultural references" stay searchable.
 */
export const UNSEARCHABLE_SECTION_HEADINGS: readonly string[] = [
  'see also',
  'external links',
  'references',
  'further reading',
  'notes',
  'bibliography',
  'sources',
  'works cited',
];

const UNSEARCHABLE = new Set(UNSEARCHABLE_SECTION_HEADINGS);

/** True when a claim may be matched against this article section. */
export function isSearchableSection(section: { heading: string | null; text: string }): boolean {
  if (section.text.trim().length < MIN_SEARCHABLE_SECTION_CHARS) return false;
  const heading = section.heading?.trim().toLowerCase().replace(/\s+/g, ' ');
  return !(heading && UNSEARCHABLE.has(heading));
}
