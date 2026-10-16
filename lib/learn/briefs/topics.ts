import type { TopicDraft } from '@/lib/learn/levels/draft-payload';
import {
  MAX_ITEMS_PER_SOURCE,
  MAX_SOURCES,
  numbered,
  type DraftSource,
  type DraftSources,
} from '@/lib/learn/levels/draft-sources';
import type { BriefSection } from './model';

export { readDraftedFromBrief, type DraftedFromBrief } from '@/lib/learn/levels/draft-sources';

/**
 * A research brief as the sources a topic is drafted from (plan #2184.1;
 * feature #2184 "Learn from your own questions").
 *
 * A ready brief has quoted words from each page it read, under the
 * sub-question each answers. Each page it cites becomes one source for the
 * topic compiler (#2138.11), its quoted words the source's lines, so every
 * level the compiler writes names the page and the words it rests on. The
 * goal the brief is put under brings its performances.
 *
 * A web page is not a syllabus, so a row the brief's pages support is
 * emerging, never canonical or practitioner; a row they do not support is
 * left uncited, to be marked personal before the topic can be approved
 * (learn 0149). The draft keeps which brief and goal it came from on
 * `topics.drafting.brief`, which is what approving it reads to put the topic
 * on the goal's lens and the brief under the goal.
 *
 * Pure: nothing here touches the database or the network.
 */

/** A page the brief read, as the drafting reads it. */
export type BriefReading = {
  readingId: string;
  title: string;
  /** Who published it, in words ("Regulator"), when the run said. */
  kind: string | null;
  /** What the research run wrote of the page, used when nothing was quoted from it. */
  summary: string | null;
};

/** Sentences of a page's summary taken as its lines when the brief quoted nothing from it. */
const SUMMARY_LINES = 4;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

/**
 * The brief's pages as numbered sources, most quoted first. A page the
 * sections quote gives its quotes as lines, in the order the sections have
 * them; when no section quotes any page, every page on the brief's list is
 * given with its summary's sentences instead. At most eight sources.
 */
export function briefDraftSources(
  brief: { question: string; sections: readonly BriefSection[] },
  pages: readonly BriefReading[],
  performances: readonly string[],
): DraftSources {
  const quotes = new Map<string, string[]>();
  for (const section of brief.sections) {
    for (const citation of section.citations) {
      const list = quotes.get(citation.reading_id) ?? [];
      if (!list.includes(citation.quote)) list.push(citation.quote);
      quotes.set(citation.reading_id, list);
    }
  }
  const label = (page: BriefReading) =>
    `From your research on “${brief.question.trim()}”: ${page.title}${page.kind ? ` (${page.kind})` : ''}`;

  const quoted = pages
    .filter((page) => (quotes.get(page.readingId)?.length ?? 0) > 0)
    .sort((a, b) => (quotes.get(b.readingId)?.length ?? 0) - (quotes.get(a.readingId)?.length ?? 0));
  const chosen: Omit<DraftSource, 'id'>[] =
    quoted.length > 0
      ? quoted.map((page) => ({ label: label(page), items: (quotes.get(page.readingId) ?? []).slice(0, MAX_ITEMS_PER_SOURCE) }))
      : pages.flatMap((page) => {
          const items = sentences(page.summary ?? '').slice(0, SUMMARY_LINES);
          return items.length > 0 ? [{ label: label(page), items }] : [];
        });
  return { sources: numbered(chosen.slice(0, MAX_SOURCES)), performances: [...performances] };
}

/**
 * A draft compiled from a brief, with every row the pages support marked
 * emerging and the topic row citing every source its levels and links cite.
 * Rows that cite nothing keep no canonicality, for the person to mark.
 */
export function asEmerging<T extends Pick<TopicDraft, 'topicCites' | 'canonicality' | 'cells' | 'links'>>(draft: T): T {
  const sourceOf = (cite: string) => cite.split('.')[0]!;
  const topicCites = [...draft.topicCites];
  for (const cite of [...draft.cells.flatMap((c) => c.cites), ...draft.links.flatMap((l) => l.cites)]) {
    const source = sourceOf(cite);
    if (source.startsWith('S') && !topicCites.some((c) => sourceOf(c) === source)) topicCites.push(source);
  }
  const mark = (cites: readonly string[]) => (cites.length > 0 ? ('emerging' as const) : null);
  return {
    ...draft,
    topicCites,
    canonicality: mark(topicCites),
    cells: draft.cells.map((cell) => ({ ...cell, canonicality: mark(cell.cites) })),
    links: draft.links.map((link) => ({ ...link, canonicality: mark(link.cites) })),
  };
}

/**
 * The goal's performances, from the newest topic on its lens that was
 * drafted with some. A goal keeps none of its own: they are typed when a
 * topic is drafted for it, and each draft keeps them on `topics.drafting`.
 */
export function goalPerformances(drafted: readonly { createdAt: string; performances: readonly string[] }[]): string[] {
  const newest = [...drafted]
    .filter((d) => d.performances.length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return newest ? [...newest.performances] : [];
}

/** A goal the brief could be put under. */
export type BriefGoalOption = { id: string; name: string };

/** A topic drafted from the brief, as its page lists it. */
export type BriefTopic = { id: string; name: string; approved: boolean; aimName: string };

/** What the brief page's goal panel shows. */
export type BriefGoalPanel = {
  goals: BriefGoalOption[];
  topics: BriefTopic[];
  /** The goal the brief is under, once a topic from it is approved. */
  aim: BriefGoalOption | null;
};
