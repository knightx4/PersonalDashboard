import type { DraftResult } from '@/lib/learn/levels/draft';
import type { CanonText, DraftedDocument } from '@/lib/learn/levels/stored-sources';

/**
 * The sources a topic is drafted from, and the five checks shown before it is
 * approved (plan #2138.11; docs/LEARN-LEVELS-SPEC.md, "Drafting a topic").
 *
 * Pure. A source is something the person gave: a pasted table of contents, an
 * exam body's outcome list, a syllabus, or the requirement lines of the roles
 * in job_search the goal names. Each source is numbered S1, S2, … and each of
 * its lines S1.1, S1.2, …, and the goal's performances P1 to P5. The drafting
 * call cites rows by those ids, and everything here reads the ids back.
 */

export const MAX_SOURCES = 8;
export const MAX_ITEMS_PER_SOURCE = 80;
export const MAX_ITEM_LENGTH = 300;
export const MAX_PERFORMANCES = 5;

/** How settled a row is (learn 0145). `personal` is the person's to set, never the call's. */
export const CANONICALITIES = ['canonical', 'practitioner', 'emerging', 'personal'] as const;
export type Canonicality = (typeof CANONICALITIES)[number];
export const CITED_CANONICALITIES = ['canonical', 'practitioner', 'emerging'] as const;
export type CitedCanonicality = (typeof CITED_CANONICALITIES)[number];

export type DraftSource = {
  /** S1, S2, … in the order given. */
  id: string;
  /** The first line of what was pasted, or the roles' description. */
  label: string;
  /** One line each, numbered from 1 in the order given. */
  items: string[];
  /**
   * A stored course's units in the order it teaches them (plan #2247.10),
   * which the call reads as weak evidence of what comes before what.
   */
  ordered?: boolean;
};

export type DraftSources = {
  sources: DraftSource[];
  /** The three to five things being able to do defines done, P1 onwards. */
  performances: string[];
};

export const NO_SOURCES: DraftSources = { sources: [], performances: [] };

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Bullets and numbering a pasted list carries, which are not part of the line. */
const LEAD = /^(?:[-*•·▪◦]|\(?\d{1,3}(?:\.\d{1,3})*[.)]?|\(?[a-z][.)])\s+/i;

function cleanLine(line: string): string {
  return tidy(line).replace(LEAD, '').slice(0, MAX_ITEM_LENGTH).trim();
}

/**
 * Sources as pasted into one box: blocks split by a blank line, the first
 * line of each naming it and every line after that one item. A block of one
 * line is a source with no items, such as a textbook named by title.
 */
export function sourcesFromText(text: string): DraftSource[] {
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map(cleanLine)
        .filter((line) => line !== ''),
    )
    .filter((lines) => lines.length > 0);
  return blocks.slice(0, MAX_SOURCES).map((lines, i) => ({
    id: `S${i + 1}`,
    label: lines[0],
    items: dedupe(lines.slice(1)).slice(0, MAX_ITEMS_PER_SOURCE),
  }));
}

function dedupe(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const k = line.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Performances, one a line, at most five. */
export function performancesFromText(text: string): string[] {
  return dedupe(
    text
      .split(/\r?\n/)
      .map(cleanLine)
      .filter((line) => line !== ''),
  ).slice(0, MAX_PERFORMANCES);
}

/**
 * The requirement lines of the roles the goal names, as one more source.
 * `roles` are the matching roles' titles and their requirement lines.
 */
export function rolesSource(
  phrase: string,
  roles: readonly { title: string; company: string | null; lines: readonly string[] }[],
): Omit<DraftSource, 'id'> | null {
  const lines = dedupe(roles.flatMap((r) => r.lines.map(cleanLine)).filter((l) => l !== '')).slice(
    0,
    MAX_ITEMS_PER_SOURCE,
  );
  if (lines.length === 0) return null;
  const n = roles.length;
  return { label: `Requirement lines of ${n} ${n === 1 ? 'role' : 'roles'} you pursued matching “${tidy(phrase)}”`, items: lines };
}

/** Renumbers sources S1… in order, so ids stay contiguous whatever was added. */
export function numbered(sources: readonly Omit<DraftSource, 'id'>[]): DraftSource[] {
  return sources.slice(0, MAX_SOURCES).map((s, i) => ({ ...s, id: `S${i + 1}` }));
}

/** The sources as the call reads them. Empty when none were given. */
export function sourcesPrompt(given: DraftSources): string[] {
  const lines: string[] = [];
  if (given.performances.length > 0) {
    lines.push('', 'Performances: what being able to do this goal means. Cite as P1, P2, …:');
    given.performances.forEach((p, i) => lines.push(`P${i + 1}. ${p}`));
  }
  if (given.sources.length > 0) {
    lines.push('', 'Sources. Cite a whole source as S1, or one of its lines as S1.3:');
    for (const source of given.sources) {
      lines.push(`${source.id}. ${source.label}${source.ordered ? ' (units in the order taught)' : ''}`);
      source.items.forEach((item, i) => lines.push(`  ${source.id}.${i + 1} ${item}`));
    }
  }
  return lines;
}

/** Every id a row may cite, so an invented one reads as no citation. */
export function citeIds(given: DraftSources): Set<string> {
  const ids = new Set<string>();
  given.performances.forEach((_, i) => ids.add(`P${i + 1}`));
  for (const source of given.sources) {
    ids.add(source.id);
    source.items.forEach((_, i) => ids.add(`${source.id}.${i + 1}`));
  }
  return ids;
}

/** The ids a row cited that exist, upper-cased, deduplicated, in order. */
export function validCites(cites: readonly string[] | undefined, ids: ReadonlySet<string>): string[] {
  const kept: string[] = [];
  for (const raw of cites ?? []) {
    const id = raw.trim().toUpperCase();
    if (ids.has(id) && !kept.includes(id)) kept.push(id);
  }
  return kept;
}

const MAX_SOURCE_TEXT = 600;

/**
 * What goes in a row's `source` column: each cited source or line in words,
 * so the row reads on its own without the draft it came from. Null for none.
 */
export function sourceText(cites: readonly string[], given: DraftSources): string | null {
  const parts: string[] = [];
  for (const id of cites) {
    const perf = /^P(\d+)$/.exec(id);
    if (perf) {
      const text = given.performances[Number(perf[1]) - 1];
      if (text) parts.push(`Your performance: ${text}`);
      continue;
    }
    const m = /^(S\d+)(?:\.(\d+))?$/.exec(id);
    const source = m ? given.sources.find((s) => s.id === m[1]) : undefined;
    if (!source || !m) continue;
    const item = m[2] ? source.items[Number(m[2]) - 1] : undefined;
    parts.push(item ? `${source.label}: ${item}` : source.label);
  }
  if (parts.length === 0) return null;
  const text = parts.join('; ');
  return text.length > MAX_SOURCE_TEXT ? `${text.slice(0, MAX_SOURCE_TEXT - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// The five checks
// ---------------------------------------------------------------------------

/** What a draft's rows cite, as the checks read it. Levels and links by key. */
export type CitedDraft = {
  ceiling: number;
  topicCites: string[];
  cells: { level: number; checks: string[]; cites: string[] }[];
  links: { fromLevel: number; topicName: string; level: number; cites: string[] }[];
  /** The level of this topic each performance needs, by its index; null when this topic does not serve it. */
  performanceLevels: (number | null)[];
  /** Source lines the call said belong to neighbouring topics, not this one. */
  outOfScope: string[];
};

export type SourceCoverage = {
  id: string;
  label: string;
  /** Lines some row cites. */
  covered: number;
  /** Lines that belong to this topic: every line less those the call put out of scope. */
  inScope: number;
  total: number;
};

export type CoverageCheck = {
  /** Covered over in scope across every source with lines; null when no source had lines. */
  share: number | null;
  sources: SourceCoverage[];
  /** Lines in scope that no row cites, as `S1.3 text`, at most eight. */
  uncovered: string[];
};

/** Coverage against the sources given: of the lines that belong here, how many a row cites. */
export function coverageCheck(draft: CitedDraft, given: DraftSources): CoverageCheck {
  const cited = new Set([
    ...draft.topicCites,
    ...draft.cells.flatMap((c) => c.cites),
    ...draft.links.flatMap((l) => l.cites),
  ]);
  const out = new Set(draft.outOfScope.map((id) => id.toUpperCase()));
  const uncovered: string[] = [];
  let coveredAll = 0;
  let inScopeAll = 0;
  const sources = given.sources.map((source) => {
    let covered = 0;
    let inScope = 0;
    source.items.forEach((item, i) => {
      const id = `${source.id}.${i + 1}`;
      if (cited.has(id)) {
        covered += 1;
        inScope += 1;
      } else if (!out.has(id)) {
        inScope += 1;
        uncovered.push(`${id} ${item}`);
      }
    });
    coveredAll += covered;
    inScopeAll += inScope;
    return { id: source.id, label: source.label, covered, inScope, total: source.items.length };
  });
  return { share: inScopeAll === 0 ? null : coveredAll / inScopeAll, sources, uncovered: uncovered.slice(0, 8) };
}

export type StructureCheck = {
  /** No requirement loops back on itself. */
  acyclic: boolean;
  /** Levels above the highest level a performance needs: on no path to a performance. */
  offPath: number[];
  /** Performances this topic serves, with the level each needs. */
  served: { performance: string; level: number }[];
  /** Performances this topic does not serve. */
  unserved: string[];
};

/**
 * Structure: the draft's requirements form no loop, and every level is on a
 * path to a performance. Levels chain upwards, so a performance needing level
 * 6 puts levels 1 to 6 on its path; a level above every performance's is on
 * none. With no performances given, no level can be judged and none is listed.
 *
 * `edges` are the requirement edges among topics the draft reaches, as
 * `from -> to` topic names, from the map; the draft's own links are added.
 */
export function structureCheck(
  draft: CitedDraft,
  given: DraftSources,
  name: string,
  edges: readonly [string, string][] = [],
): StructureCheck {
  const served: StructureCheck['served'] = [];
  const unserved: string[] = [];
  given.performances.forEach((performance, i) => {
    const level = draft.performanceLevels[i] ?? null;
    if (level !== null && level >= 1 && level <= draft.ceiling) served.push({ performance, level });
    else unserved.push(performance);
  });
  const top = served.reduce((best, s) => Math.max(best, s.level), 0);
  const offPath =
    given.performances.length === 0
      ? []
      : draft.cells.map((c) => c.level).filter((level) => level > top);

  const graph = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    const k = from.toLowerCase();
    if (!graph.has(k)) graph.set(k, new Set());
    graph.get(k)!.add(to.toLowerCase());
  };
  for (const [from, to] of edges) add(from, to);
  for (const link of draft.links) add(name, link.topicName);

  return { acyclic: !hasCycle(graph), offPath, served, unserved };
}

function hasCycle(graph: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const state = new Map<string, 'open' | 'done'>();
  const visit = (node: string): boolean => {
    const was = state.get(node);
    if (was === 'open') return true;
    if (was === 'done') return false;
    state.set(node, 'open');
    for (const next of graph.get(node) ?? []) if (visit(next)) return true;
    state.set(node, 'done');
    return false;
  };
  return [...graph.keys()].some((node) => visit(node));
}

const STOP = new Set([
  'can', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'why', 'how', 'its', 'their', 'into',
  'when', 'which', 'one', 'such', 'are', 'was', 'not', 'say', 'name', 'explain',
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  return both / (a.size + b.size - both);
}

/**
 * How far two drafts of one goal agree, from 0 to 1: the mean of three
 * overlaps. Levels compare the words of each level's checks, a level only
 * one draft has counting as none in common; links compare which topic at
 * which level each needs; citations compare the ids each draft cites.
 */
export function draftOverlap(a: CitedDraft, b: CitedDraft): number {
  const top = Math.max(a.ceiling, b.ceiling);
  let levels = 0;
  for (let level = 1; level <= top; level += 1) {
    const ca = a.cells.find((c) => c.level === level);
    const cb = b.cells.find((c) => c.level === level);
    if (ca && cb) levels += jaccard(words(ca.checks.join(' ')), words(cb.checks.join(' ')));
  }
  const levelShare = top === 0 ? 1 : levels / top;
  const linkKey = (d: CitedDraft) => new Set(d.links.map((l) => `${l.topicName.toLowerCase()}@${l.level}`));
  const citeKey = (d: CitedDraft) =>
    new Set([...d.topicCites, ...d.cells.flatMap((c) => c.cites), ...d.links.flatMap((l) => l.cites)]);
  return (levelShare + jaccard(linkKey(a), linkKey(b)) + jaccard(citeKey(a), citeKey(b))) / 3;
}

/** Rows that land on the map: the topic, each level and each link. */
export function uncitedCount(draft: CitedDraft): { cited: number; total: number } {
  const rows = [draft.topicCites, ...draft.cells.map((c) => c.cites), ...draft.links.map((l) => l.cites)];
  return { cited: rows.filter((c) => c.length > 0).length, total: rows.length };
}

/**
 * Of two drafts, the one to keep: the one more of whose rows cite a source,
 * then the one covering more of the sources; the first on a tie.
 */
export function pickDraft<T extends CitedDraft>(a: T, b: T, given: DraftSources): T {
  const ua = uncitedCount(a);
  const ub = uncitedCount(b);
  const ra = ua.total === 0 ? 0 : ua.cited / ua.total;
  const rb = ub.total === 0 ? 0 : ub.cited / ub.total;
  if (rb > ra) return b;
  if (ra > rb) return a;
  const ca = coverageCheck(a, given).share ?? 0;
  const cb = coverageCheck(b, given).share ?? 0;
  return cb > ca ? b : a;
}

/** What is kept on the topic (`topics.drafting`) from drafting it: the sources and the checks the draft alone can give. */
export type DraftingRecord = {
  sources: DraftSource[];
  performances: string[];
  coverage: CoverageCheck;
  structure: StructureCheck;
  /** Overlap between the two drafts, 0 to 1; null when only one came back. */
  overlap: number | null;
  /** Why there is no overlap, when there is none. */
  overlapMissing: string | null;
  /** Questions a practitioner would put to the top levels. */
  checklist: string[];
  /** The stored documents the draft cites (plan #2247.10); absent when none were read. */
  documents?: DraftedDocument[];
  /** The textbooks the stored documents name, with how many name each; absent when none were read. */
  canon?: CanonText[];
};

/** `topics.drafting` as read back; null for a topic drafted before sources (or a shape not written here). */
export function readDrafting(value: unknown): DraftingRecord | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<DraftingRecord>;
  if (!Array.isArray(v.sources) || !Array.isArray(v.performances) || !v.coverage || !v.structure) return null;
  return {
    sources: v.sources,
    performances: v.performances,
    coverage: v.coverage,
    structure: v.structure,
    overlap: typeof v.overlap === 'number' ? v.overlap : null,
    overlapMissing: typeof v.overlapMissing === 'string' ? v.overlapMissing : null,
    checklist: Array.isArray(v.checklist) ? v.checklist.filter((c): c is string => typeof c === 'string') : [],
    ...(Array.isArray(v.documents) ? { documents: v.documents } : {}),
    ...(Array.isArray(v.canon) ? { canon: v.canon } : {}),
  };
}

/** Below these the check is flagged rather than passed. */
export const COVERAGE_FLAG = 0.6;
export const OVERLAP_FLAG = 0.5;

type Drafted = Extract<DraftResult, { ok: true }>['draft'];

/**
 * Two calls' results as one: both drafts, or the one that came back with why
 * the other did not. A goal either call found too broad is too broad.
 */
export function bothOrEither(
  a: DraftResult,
  b: DraftResult,
): { ok: true; draft: Drafted; other: Drafted | null; failed: string | null } | Extract<DraftResult, { ok: false }> {
  if (!a.ok && a.reason === 'too-vague') return a;
  if (!b.ok && b.reason === 'too-vague') return b;
  if (a.ok && b.ok) return { ok: true, draft: a.draft, other: b.draft, failed: null };
  if (a.ok && !b.ok) return { ok: true, draft: a.draft, other: null, failed: b.detail };
  if (!a.ok && b.ok) return { ok: true, draft: b.draft, other: null, failed: a.detail };
  if (!a.ok) return a;
  return { ok: true, draft: a.draft, other: null, failed: null };
}

/** What goes on the kept draft's topic: its sources, and the checks the two drafts give. */
export function draftingRecord(
  kept: CitedDraft & { name: string; checklist: string[] },
  other: CitedDraft | null,
  failed: string | null,
  given: DraftSources,
): DraftingRecord {
  return {
    sources: given.sources,
    performances: given.performances,
    coverage: coverageCheck(kept, given),
    structure: structureCheck(kept, given, kept.name),
    overlap: other ? draftOverlap(kept, other) : null,
    overlapMissing: other ? null : `The second draft failed (${failed ?? 'no reason given'}), so there is nothing to compare.`,
    checklist: kept.checklist,
  };
}
