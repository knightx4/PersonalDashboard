import type { NearestStructureUnit } from '@/lib/learn/catalogue/structure-store';
import type { LicenceMode } from '@/lib/learn/catalogue/structure';
import type { TopicDraft } from '@/lib/learn/levels/draft-payload';
import {
  MAX_ITEM_LENGTH,
  MAX_SOURCES,
  numbered,
  type CitedCanonicality,
  type DraftSource,
  type DraftSources,
} from '@/lib/learn/levels/draft-sources';

/**
 * Stored documents as sources for the compiler (plan #2247.10).
 *
 * Pure. Before a territory is drafted, the goal and its performances are
 * embedded and searched against every unit of every stored structure document
 * (stored-sources-run.ts), so a week is found by what it covers rather than by
 * its course's title, and a goal narrower than any course is served by weeks
 * from several. This file turns those matches into numbered sources the
 * drafting call of plan #2138.11 reads and cites, and reads the draft back to
 * say which documents each row came from.
 *
 * What reaches the model of a stored document is its title, the unit's own
 * label and heading, and the unit's topics: the structure, which the compiler
 * may read whatever the licence mode. Never the raw text and never a unit's
 * readings. The licence mode is kept on the reference so whatever later
 * writes material from the draft can read it before using a word.
 *
 * Canonicality follows the count of independent documents a row cites: two or
 * more is canonical, one is practitioner. Two terms of one course are one
 * document for that count, since they are one instructor's view.
 */

/** Stored documents at most per draft, leaving room for the sources somebody pasted. */
export const MAX_STORED_DOCUMENTS = 6;
/** Units at most taken from one document. */
export const MAX_UNITS_PER_DOCUMENT = 12;

/** What else is known of a matched document than its units: the textbooks it names. */
export type StoredDocumentInfo = { itemId: string; textbooks: string[] };

/** A stored document as the draft cites it. */
export type StoredSourceRef = {
  /** The source id it was given, S3. */
  sourceId: string;
  itemId: string;
  title: string;
  url: string;
  institution: string | null;
  courseCode: string | null;
  term: string | null;
  licenceMode: LicenceMode;
  /** Documents with one key count once towards canonicality. */
  independence: string;
  /** The units given, by ordinal in document order; line n of the source is units[n - 1]. */
  units: { ordinal: number; segmentId: string; similarity: number }[];
};

/** A textbook the stored documents name, with how many independent documents name it. */
export type CanonText = { title: string; documents: number };

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The best match of each unit across several searches, closest first. */
export function mergeMatches(lists: readonly (readonly NearestStructureUnit[])[]): NearestStructureUnit[] {
  const best = new Map<string, NearestStructureUnit>();
  for (const list of lists) {
    for (const match of list) {
      const was = best.get(match.segmentId);
      if (!was || match.similarity > was.similarity) best.set(match.segmentId, match);
    }
  }
  return [...best.values()].sort((a, b) => b.similarity - a.similarity);
}

/**
 * What makes two documents one for counting: the institution and course code
 * when the document has a code, so two terms of a course are one; otherwise
 * the document itself.
 */
export function independenceKey(doc: { itemId: string; institution: string | null; courseCode: string | null }): string {
  const code = doc.courseCode ? tidy(doc.courseCode).toLowerCase() : '';
  if (!code) return `item:${doc.itemId}`;
  return `course:${tidy(doc.institution ?? '').toLowerCase()}|${code}`;
}

/** The source's label: the document named so a row's source reads on its own. */
export function documentLabel(doc: {
  title: string;
  institution: string | null;
  courseCode: string | null;
  term: string | null;
}): string {
  const where = [doc.institution, doc.courseCode].map((part) => tidy(part ?? '')).filter((part) => part !== '');
  const term = doc.term ? ` (${tidy(doc.term)})` : '';
  return `${where.length > 0 ? `${where.join(' ')}, ` : ''}${tidy(doc.title)}${term}`;
}

/** One unit as a source line: its label, heading and topics. Never its readings or text. */
export function unitLine(unit: { label: string | null; heading: string; topics: readonly string[] }): string {
  const head = unit.label ? `${tidy(unit.label)}: ${tidy(unit.heading)}` : tidy(unit.heading);
  const topics = unit.topics.map(tidy).filter((t) => t !== '');
  const line = topics.length > 0 ? `${head}. Topics: ${topics.join('; ')}` : head;
  return line.length > MAX_ITEM_LENGTH ? `${line.slice(0, MAX_ITEM_LENGTH - 1)}…` : line;
}

type Grouped = { first: NearestStructureUnit; best: number; units: NearestStructureUnit[] };

/**
 * The matched documents as sources, best document first, each with its
 * matched units in the document's own order: the order is what the call reads
 * as weak evidence of what is taught before what.
 */
export function storedSourcesFrom(
  matches: readonly NearestStructureUnit[],
  options: { maxDocuments?: number } = {},
): { sources: Omit<DraftSource, 'id'>[]; refs: Omit<StoredSourceRef, 'sourceId'>[] } {
  const byItem = new Map<string, Grouped>();
  for (const match of mergeMatches([matches])) {
    const group = byItem.get(match.itemId);
    if (group) group.units.push(match);
    else byItem.set(match.itemId, { first: match, best: match.similarity, units: [match] });
  }
  const chosen = [...byItem.values()]
    .sort((a, b) => b.best - a.best)
    .slice(0, options.maxDocuments ?? MAX_STORED_DOCUMENTS);

  const sources: Omit<DraftSource, 'id'>[] = [];
  const refs: Omit<StoredSourceRef, 'sourceId'>[] = [];
  for (const { first, units } of chosen) {
    const kept = units.slice(0, MAX_UNITS_PER_DOCUMENT).sort((a, b) => a.ordinal - b.ordinal);
    sources.push({ label: documentLabel({ ...first, title: first.documentTitle }), items: kept.map(unitLine), ordered: true });
    refs.push({
      itemId: first.itemId,
      title: first.documentTitle,
      url: first.canonicalUrl,
      institution: first.institution,
      courseCode: first.courseCode,
      term: first.term,
      licenceMode: first.licenceMode,
      independence: independenceKey(first),
      units: kept.map((u) => ({ ordinal: u.ordinal, segmentId: u.segmentId, similarity: u.similarity })),
    });
  }
  return { sources, refs };
}

/**
 * The sources a draft is given: what was pasted or read from the roles first,
 * then the stored documents in the slots left, all numbered S1 onwards.
 */
export function withStoredSources(
  given: DraftSources,
  stored: { sources: readonly Omit<DraftSource, 'id'>[]; refs: readonly Omit<StoredSourceRef, 'sourceId'>[] },
): { given: DraftSources; refs: StoredSourceRef[] } {
  const room = Math.max(0, MAX_SOURCES - given.sources.length);
  const take = Math.min(room, stored.sources.length);
  const own = given.sources.map((source) => ({ label: source.label, items: source.items, ...(source.ordered ? { ordered: true } : {}) }));
  const sources = numbered([...own, ...stored.sources.slice(0, take)]);
  const refs = stored.refs.slice(0, take).map((ref, i) => ({ ...ref, sourceId: sources[own.length + i].id }));
  return { given: { sources, performances: given.performances }, refs };
}

/** The source id a cite belongs to: S3 for S3 and for S3.2. */
const sourceOf = (cite: string): string => cite.split('.')[0];

/** The stored documents a set of cites reaches, as references. */
export function documentsCited(cites: readonly string[], refs: readonly StoredSourceRef[]): StoredSourceRef[] {
  const ids = new Set(cites.map(sourceOf));
  return refs.filter((ref) => ids.has(ref.sourceId));
}

/**
 * A row's canonicality from the stored documents it cites: canonical in two or
 * more independent documents, practitioner in one. A row citing no stored
 * document keeps what the call said, and an emerging row in one document
 * stays emerging.
 */
export function canonicalityByDocuments(
  cites: readonly string[],
  said: CitedCanonicality | null,
  refs: readonly StoredSourceRef[],
): CitedCanonicality | null {
  const independent = new Set(documentsCited(cites, refs).map((ref) => ref.independence)).size;
  if (independent >= 2) return 'canonical';
  if (independent === 1) return said === 'emerging' ? 'emerging' : 'practitioner';
  return said;
}

/**
 * The draft with the stored documents read back into it. The topic row cites
 * every stored document any of its levels or links cites, so the topic names
 * its documents; then every row's canonicality is set by the count.
 */
export function withDocumentCanonicality<T extends Pick<TopicDraft, 'topicCites' | 'canonicality' | 'cells' | 'links'>>(
  draft: T,
  refs: readonly StoredSourceRef[],
): T {
  if (refs.length === 0) return draft;
  const reached = documentsCited(
    [...draft.topicCites, ...draft.cells.flatMap((c) => c.cites), ...draft.links.flatMap((l) => l.cites)],
    refs,
  );
  const topicCites = [...draft.topicCites];
  for (const ref of reached) {
    if (!topicCites.some((cite) => sourceOf(cite) === ref.sourceId)) topicCites.push(ref.sourceId);
  }
  const said = draft.canonicality ?? (topicCites.length > 0 ? 'practitioner' : null);
  return {
    ...draft,
    topicCites,
    canonicality: canonicalityByDocuments(topicCites, said, refs),
    cells: draft.cells.map((cell) => ({ ...cell, canonicality: canonicalityByDocuments(cell.cites, cell.canonicality, refs) })),
    links: draft.links.map((link) => ({ ...link, canonicality: canonicalityByDocuments(link.cites, link.canonicality, refs) })),
  };
}

/**
 * The textbooks the stored documents name, kept on the territory as its
 * canon: each title once, with how many independent documents name it, most
 * named first and then by title.
 */
export function territoryCanon(
  refs: readonly Pick<StoredSourceRef, 'itemId' | 'independence'>[],
  info: readonly StoredDocumentInfo[],
): CanonText[] {
  const books = new Map(info.map((doc) => [doc.itemId, doc.textbooks]));
  const named = new Map<string, { title: string; keys: Set<string> }>();
  for (const ref of refs) {
    for (const raw of books.get(ref.itemId) ?? []) {
      const title = tidy(raw);
      if (!title) continue;
      const key = title.toLowerCase();
      const entry = named.get(key) ?? { title, keys: new Set<string>() };
      entry.keys.add(ref.independence);
      named.set(key, entry);
    }
  }
  return [...named.values()]
    .map((entry) => ({ title: entry.title, documents: entry.keys.size }))
    .sort((a, b) => b.documents - a.documents || a.title.localeCompare(b.title));
}

/** What goes on the topic's `drafting` of the stored documents it read: each document, and the units of it the draft cites. */
export type DraftedDocument = {
  sourceId: string;
  itemId: string;
  title: string;
  url: string;
  licenceMode: LicenceMode;
  /** Ordinals of the units some row cites, in order. */
  citedUnits: number[];
};

export function draftedDocuments(
  draft: Pick<TopicDraft, 'topicCites' | 'cells' | 'links'>,
  refs: readonly StoredSourceRef[],
): DraftedDocument[] {
  const cites = new Set([...draft.topicCites, ...draft.cells.flatMap((c) => c.cites), ...draft.links.flatMap((l) => l.cites)]);
  return documentsCited([...cites], refs).map((ref) => ({
    sourceId: ref.sourceId,
    itemId: ref.itemId,
    title: ref.title,
    url: ref.url,
    licenceMode: ref.licenceMode,
    citedUnits: ref.units
      .filter((_, i) => cites.has(`${ref.sourceId}.${i + 1}`))
      .map((unit) => unit.ordinal),
  }));
}
