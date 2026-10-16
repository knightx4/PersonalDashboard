import { createHash } from 'node:crypto';

/**
 * Structure documents: a syllabus, a course calendar, a table of contents or
 * a primary-source index, kept whole in the catalogue (plan #2247.1).
 *
 * A document is a `catalogue_items` row of kind `structure` with one
 * `catalogue_structures` row beside it, and its units (weeks, sessions,
 * chapters, lectures) are `catalogue_segments` rows in published order. This
 * file is the part with no database in it: the shapes a provider hands over,
 * the hash that tells an unchanged document from a changed one, the text a
 * unit is embedded by, and what each licence mode allows. The writes are in
 * structure-store.ts.
 */

/**
 * What a document may be used for, read before the material path uses a word
 * of it.
 *
 * - `show`: the text may be shown and given to a model, with attribution.
 * - `structure_only`: the order, headings and topics may be used; the text is
 *   neither shown nor given to a model. A syllabus under its instructor's
 *   copyright.
 * - `never_feed`: nothing beyond the headings goes to a model. OpenStax.
 */
export const LICENCE_MODES = ['show', 'structure_only', 'never_feed'] as const;
export type LicenceMode = (typeof LICENCE_MODES)[number];

export function isLicenceMode(value: unknown): value is LicenceMode {
  return typeof value === 'string' && (LICENCE_MODES as readonly string[]).includes(value);
}

/** Whether a document's text may be shown to the person. */
export function mayShowText(mode: LicenceMode): boolean {
  return mode === 'show';
}

/**
 * Whether a document's text may be given to a model as material: to write a
 * card from, to grade against, to quote. Only `show`. Headings and topics of
 * any mode may still be read by the compiler, which is what a structure
 * document is for.
 */
export function mayFeedText(mode: LicenceMode): boolean {
  return mode === 'show';
}

/** One reading a unit assigns. */
export type StructureReading = {
  title: string;
  /** Pages, a chapter, "pp. 12-40", as the document gives it. */
  detail?: string;
  url?: string;
};

/** One unit of a document, in the document's own order. */
export type StructureUnit = {
  /** The document's numbering, verbatim: "Week 3", "Session 7". Null when it has none. */
  label: string | null;
  /** The unit's title, or the first topic when the document gives no title. */
  heading: string;
  topics: string[];
  readings: StructureReading[];
};

/** What a provider hands the store for one document. */
export type StructureDocumentInput = {
  providerSlug: string;
  /** The provider's identifier: an OCW course number, a UT syllabus id, an arXiv id. */
  externalId: string;
  title: string;
  /** The page a person would open. */
  canonicalUrl: string;
  /** Where the document itself was fetched from; often the same as canonicalUrl. */
  sourceUrl: string;
  author?: string | null;
  institution?: string | null;
  courseCode?: string | null;
  term?: string | null;
  licenceMode: LicenceMode;
  /** The text as pulled, before any parsing. */
  rawText: string;
  textbooks?: string[];
  /** Learning outcomes, as the document words them. */
  outcomes?: string[];
  /** Prerequisites, as the document words them: a course code or a sentence. */
  prerequisites?: string[];
  units: StructureUnit[];
};

/**
 * The hash a document is compared by: SHA-256 of its raw text, hex. The same
 * idea as the vault map's blob_sha. A re-pull whose hash matches what is
 * stored leaves the units and their vectors as they are.
 */
export function structureContentHash(rawText: string): string {
  return createHash('sha256').update(rawText, 'utf8').digest('hex');
}

/**
 * The text a unit is stored and embedded by. The label and heading, then its
 * topics and readings, so a week is found by what it covers and by what it
 * assigns as well as by its title.
 */
export function unitText(unit: StructureUnit): string {
  const lines = [unit.label ? `${unit.label}: ${unit.heading}` : unit.heading];
  if (unit.topics.length > 0) lines.push(`Topics: ${unit.topics.join('; ')}`);
  if (unit.readings.length > 0) {
    lines.push(
      `Readings: ${unit.readings
        .map((reading) => (reading.detail ? `${reading.title} (${reading.detail})` : reading.title))
        .join('; ')}`,
    );
  }
  return lines.join('\n');
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value !== '');
}

export type StructureUnitRow = {
  ordinal: number;
  unit_label: string | null;
  heading: string;
  topics: string[];
  readings: StructureReading[];
  text: string;
};

/**
 * The segment rows for a document's units, numbered from 0 in order. A unit
 * with no heading is refused, since the table needs text and a card needs
 * something to show; an empty topic or reading is dropped.
 */
export function unitRows(units: StructureUnit[]): StructureUnitRow[] {
  return units.map((unit, ordinal) => {
    const heading = unit.heading.trim();
    if (!heading) throw new Error(`Unit ${ordinal} of a structure document has no heading.`);
    const tidy: StructureUnit = {
      label: clean(unit.label),
      heading,
      topics: cleanList(unit.topics),
      readings: unit.readings
        .map((reading) => ({
          title: reading.title.trim(),
          ...(clean(reading.detail) ? { detail: clean(reading.detail)! } : {}),
          ...(clean(reading.url) ? { url: clean(reading.url)! } : {}),
        }))
        .filter((reading) => reading.title !== ''),
    };
    return {
      ordinal,
      unit_label: tidy.label,
      heading: tidy.heading,
      topics: tidy.topics,
      readings: tidy.readings,
      text: unitText(tidy),
    };
  });
}

/** The `catalogue_structures` columns for a document, tidied. */
export function structureRow(input: StructureDocumentInput) {
  if (!isLicenceMode(input.licenceMode)) {
    throw new Error(`Unknown licence mode ${String(input.licenceMode)}.`);
  }
  if (!input.rawText.trim()) throw new Error(`${input.title} has no raw text to keep.`);
  return {
    institution: clean(input.institution),
    course_code: clean(input.courseCode),
    term: clean(input.term),
    licence_mode: input.licenceMode,
    source_url: input.sourceUrl,
    raw_text: input.rawText,
    content_hash: structureContentHash(input.rawText),
    textbooks: cleanList(input.textbooks),
    outcomes: cleanList(input.outcomes),
    prerequisites: cleanList(input.prerequisites),
  };
}
