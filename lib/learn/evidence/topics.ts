/**
 * Which Level 3 and 4 topics your notes, courses, work and ideas unlock
 * (plan #2016.3). Pure, so the rules can be tested without a database; the
 * store that reads the sources and writes the links is ./topics-store.
 *
 * A topic unlocks in one of three ways:
 *
 *   1. Your text names it by a sure name: a title of two or more words
 *      ("Expected value", "Four Noble Truths"), or a short capitalised name
 *      such as "LBO" or "CAPM", matched case for case.
 *   2. Your text names it by a loose name, and the same text is about it: a
 *      one-word title ("Time", "Stoicism"), the bare part of a title that has
 *      a qualifier ("Derivative" for "Derivative (finance)"), or one of the
 *      other names Wikipedia redirects from, with the source's vector at
 *      NAME_CONFIRM_SIMILARITY or closer to the topic's. On the live vault a
 *      one-word title is named in 1,684 topics' worth of notes, from "Time"
 *      in 379 of them to "Well", "Lead" and "Bit" read in the wrong sense,
 *      and redirects include phrases such as "the change" and "for lease".
 *   3. Two sources agree: one source's vector is STRONG_SIMILARITY or closer
 *      to the topic, and a source from another document is at least
 *      AGREE_SIMILARITY. One match alone never unlocks anything, however
 *      close, since similarity alone put "the three statements are linked"
 *      on Metabolism.
 *
 * Every unlock is kept as links in learn.evidence_links, target_kind
 * 'topic', with the source, how close it is, how much it counts (the same
 * weights as the links to ideas) and a basis sentence. At most
 * LINKS_PER_TOPIC links are kept per topic, names first.
 */

import { courseName, courseWeight } from './courses';
import type { EvidenceSourceKind } from './model';
import { noteName, noteWeight } from './notes';

/** A source this close to a topic can unlock it, if another source agrees. */
export const STRONG_SIMILARITY = 0.65;
/** How close a second source must be to agree. */
export const AGREE_SIMILARITY = 0.55;
/** A loose name counts where the text is at least this close to the topic. */
export const NAME_CONFIRM_SIMILARITY = 0.5;
/** Nearest topics asked for per source. */
export const TOPICS_PER_SOURCE = 5;
/** Links kept per topic. */
export const LINKS_PER_TOPIC = 5;
/** Names longer than this many words are not looked for. */
const MAX_NAME_WORDS = 6;

// -- Names --------------------------------------------------------------------------

export type TopicArticle = { id: string; title: string; aliases: string[] | null };

type NameEntry = { topicId: string; name: string; sure: boolean };

/** Every topic's names, by the words they are matched on. */
export type TopicNameIndex = {
  /** Lowercase words joined by a space. */
  words: Map<string, NameEntry[]>;
  /** Capitalised short names, matched case for case. */
  capitals: Map<string, NameEntry[]>;
  longest: number;
};

/** Words that say nothing on their own: a name made only of these is dropped. */
const STOPWORDS = new Set(
  (
    'a an the of in on at to for and or but nor is are was were be been by with as from it its ' +
    'this that these those i me my you your he him his she her we us our they them their not no ' +
    'yes so if then than up out over into about all any some one two'
  ).split(' '),
);
/** A web address's last part: "yale edu" is an address, not a mention. */
const WEB_ENDINGS = new Set(['com', 'org', 'edu', 'net', 'gov', 'io']);

const WORD_RE = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

/** The words of a text as written, accents and curly apostrophes evened out. */
export function wordsOf(text: string): string[] {
  const plain = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'");
  return plain.match(WORD_RE) ?? [];
}

/** A short name in capitals, such as LBO or CAPM. */
function isCapitals(name: string): boolean {
  return /^[A-Z][A-Z0-9]{2,5}$/.test(name) && !/^\d+$/.test(name);
}

/** Whether lowercase words could stand for a topic at all. */
function usable(words: string[]): boolean {
  if (words.length === 0 || words.length > MAX_NAME_WORDS) return false;
  if (WEB_ENDINGS.has(words[words.length - 1])) return false;
  const telling = words.filter((w) => !STOPWORDS.has(w) && w.length > 1 && !/^\d+$/.test(w));
  if (telling.length === 0) return false;
  return !(words.length === 1 && words[0].length < 3);
}

function add(map: Map<string, NameEntry[]>, key: string, entry: NameEntry) {
  const list = map.get(key);
  if (!list) map.set(key, [entry]);
  else if (!list.some((e) => e.topicId === entry.topicId && e.sure === entry.sure)) list.push(entry);
}

/** The names of every topic, ready to look for in a text. */
export function buildTopicNames(articles: readonly TopicArticle[]): TopicNameIndex {
  const index: TopicNameIndex = { words: new Map(), capitals: new Map(), longest: 1 };
  const put = (topicId: string, name: string, sure: boolean) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (isCapitals(trimmed)) {
      add(index.capitals, trimmed, { topicId, name: trimmed, sure: true });
      return;
    }
    const words = wordsOf(trimmed).map((w) => w.toLowerCase());
    if (!usable(words)) return;
    add(index.words, words.join(' '), { topicId, name: trimmed, sure: sure && words.length >= 2 });
    index.longest = Math.max(index.longest, words.length);
  };

  for (const article of articles) {
    const qualified = /^(.*?)\s*\([^)]*\)\s*$/.exec(article.title);
    // "Interest (economics)" is named in text as "interest", which is loose.
    if (qualified) put(article.id, qualified[1], false);
    else put(article.id, article.title, true);
    for (const alias of article.aliases ?? []) {
      if (alias.includes('(')) continue;
      put(article.id, alias, false);
    }
  }
  return index;
}

export type NameFind = { name: string; sure: boolean };

/** The topics a text names, each once, a sure name over a loose one. */
export function findTopicNames(index: TopicNameIndex, text: string): Map<string, NameFind> {
  const found = new Map<string, NameFind>();
  const note = (entries: NameEntry[] | undefined) => {
    for (const entry of entries ?? []) {
      const had = found.get(entry.topicId);
      if (!had || (entry.sure && !had.sure)) found.set(entry.topicId, { name: entry.name, sure: entry.sure });
    }
  };

  const raw = wordsOf(text);
  const lower = raw.map((w) => w.toLowerCase());
  for (let i = 0; i < raw.length; i++) {
    note(index.capitals.get(raw[i]));
    let key = '';
    for (let n = 1; n <= index.longest && i + n <= lower.length; n++) {
      key = n === 1 ? lower[i] : `${key} ${lower[i + n - 1]}`;
      note(index.words.get(key));
    }
  }
  return found;
}

// -- Sources --------------------------------------------------------------------------

/** One row of learn.topic_unlock_sources. */
export type TopicSourceRow = {
  source_id: string;
  document_id: string;
  title: string | null;
  body: string | null;
  detail: string | null;
  created_at: string | null;
  written_at: string | null;
  grade: string | null;
  year: number | null;
  origin: string | null;
  weight: number | null;
};

/** What can unlock a topic: the idea kinds of evidence, and your ideas themselves. */
export type TopicSourceKind = Extract<EvidenceSourceKind, 'note' | 'course' | 'work'> | 'idea';
export const TOPIC_SOURCE_KINDS: readonly TopicSourceKind[] = ['note', 'course', 'work', 'idea'];

/** A source as the rules see it. */
export type TopicSource = {
  kind: TopicSourceKind;
  id: string;
  /** The note, course, résumé or idea it is part of: two passages of one note do not agree. */
  document: string;
  /** How it is named in a basis: "your note Stoicism". */
  label: string;
  weight: number;
  /** The text names are looked for in. */
  text: string;
};

/**
 * A source row as the rules see it, or null when it counts for nothing: a
 * course whose grade counts nothing, a passage with no weight.
 */
export function topicSource(kind: TopicSourceKind, row: TopicSourceRow, nowYear: number): TopicSource | null {
  const body = row.body ?? '';
  switch (kind) {
    case 'note': {
      const path = row.detail ?? '';
      const name = noteName({ path, title: row.title });
      const weight = noteWeight({ path, created_at: row.created_at ?? '', written_at: row.written_at ?? '' });
      return { kind, id: row.source_id, document: row.document_id, label: `your note ${name}`, weight, text: `${name}\n${body}` };
    }
    case 'course': {
      const title = row.title?.trim() ?? '';
      const weight = courseWeight({ grade: row.grade, year: row.year }, nowYear);
      if (!title || weight <= 0) return null;
      const label = courseName({ code: row.detail, title });
      return { kind, id: row.source_id, document: row.document_id, label, weight, text: title };
    }
    case 'work': {
      const weight = row.weight ?? 0;
      if (weight <= 0) return null;
      const line = row.detail?.trim() ?? '';
      const title = row.title?.trim() || 'a Career note';
      const label =
        row.origin === 'resume'
          ? `your résumé: "${line}"`
          : row.origin === 'application'
            ? `your application notes in ${title}`
            : `your note ${title}: "${line}"`;
      return { kind, id: row.source_id, document: row.document_id, label, weight, text: body };
    }
    case 'idea': {
      const name = row.title?.trim() ?? '';
      if (!name) return null;
      return { kind, id: row.source_id, document: row.document_id, label: `your idea "${name}"`, weight: 1, text: body };
    }
  }
}

// -- Deciding -------------------------------------------------------------------------

/** Something a source says about a topic. */
export type TopicHit = {
  topicId: string;
  source: TopicSource;
  /** Set when the source's text names the topic. */
  name?: NameFind;
  /** How close the source's vector is to the topic's; null when it has none. */
  similarity: number | null;
};

/** A row for learn.evidence_links, less the user id the store adds. */
export type TopicLinkRow = {
  target_kind: 'topic';
  target_id: string;
  source_kind: TopicSourceKind;
  source_id: string;
  similarity: number;
  weight: number;
  basis: string;
  matched_by: 'name' | 'similarity';
};

const sourceKey = (source: TopicSource) => `${source.kind} ${source.id}`;

/** Whether a name on its own unlocks: a sure one, or a loose one the text is about. */
function nameCounts(hit: TopicHit): boolean {
  if (!hit.name) return false;
  return hit.name.sure || (hit.similarity ?? 0) >= NAME_CONFIRM_SIMILARITY;
}

/**
 * The links that unlock topics. Hits for the same topic and source are
 * merged first: the name kept, the closer similarity kept. A topic with no
 * name that counts and no two agreeing sources gets no link at all.
 */
export function decideTopicUnlocks(hits: readonly TopicHit[]): TopicLinkRow[] {
  const byTopic = new Map<string, Map<string, TopicHit>>();
  for (const hit of hits) {
    if (!(hit.source.weight > 0)) continue;
    const sources = byTopic.get(hit.topicId) ?? new Map<string, TopicHit>();
    byTopic.set(hit.topicId, sources);
    const key = sourceKey(hit.source);
    const had = sources.get(key);
    if (!had) {
      sources.set(key, { ...hit });
      continue;
    }
    const name = had.name && (!hit.name || had.name.sure || !hit.name.sure) ? had.name : hit.name;
    const similarity =
      had.similarity === null ? hit.similarity : hit.similarity === null ? had.similarity : Math.max(had.similarity, hit.similarity);
    sources.set(key, { ...had, name, similarity });
  }

  const rows: TopicLinkRow[] = [];
  for (const [topicId, sources] of byTopic) {
    const all = [...sources.values()];
    const named = all.filter(nameCounts);

    const close = all.filter((h) => (h.similarity ?? 0) >= AGREE_SIMILARITY);
    const agreed = close.some(
      (strong) =>
        (strong.similarity ?? 0) >= STRONG_SIMILARITY &&
        close.some((other) => other.source.document !== strong.source.document),
    );

    const namedKeys = new Set(named.map((h) => sourceKey(h.source)));
    const kept = [
      ...named.map((hit) => ({ hit, by: 'name' as const })),
      ...(agreed ? close.filter((h) => !namedKeys.has(sourceKey(h.source))) : []).map((hit) => ({
        hit,
        by: 'similarity' as const,
      })),
    ];
    if (kept.length === 0) continue;

    kept
      .sort(
        (a, b) =>
          (a.by === b.by ? 0 : a.by === 'name' ? -1 : 1) ||
          b.hit.source.weight * (b.hit.similarity ?? 0) - a.hit.source.weight * (a.hit.similarity ?? 0) ||
          b.hit.source.weight - a.hit.source.weight ||
          sourceKey(a.hit.source).localeCompare(sourceKey(b.hit.source)),
      )
      .slice(0, LINKS_PER_TOPIC)
      .forEach(({ hit, by }) => {
        rows.push({
          target_kind: 'topic',
          target_id: topicId,
          source_kind: hit.source.kind,
          source_id: hit.source.id,
          similarity: Math.min(1, Math.max(0, hit.similarity ?? 0)),
          weight: Math.min(1, Math.max(0, hit.source.weight)),
          basis: by === 'name' ? `named in ${hit.source.label}` : `close to ${hit.source.label}`,
          matched_by: by,
        });
      });
  }
  return rows;
}

/** The ids of topic links a refresh no longer finds. */
export function staleTopicLinkIds(
  existing: readonly { id: string; target_id: string; source_kind: string; source_id: string }[],
  fresh: readonly Pick<TopicLinkRow, 'target_id' | 'source_kind' | 'source_id'>[],
): string[] {
  const keep = new Set(fresh.map((row) => `${row.target_id} ${row.source_kind} ${row.source_id}`));
  return existing
    .filter((row) => !keep.has(`${row.target_id} ${row.source_kind} ${row.source_id}`))
    .map((row) => row.id);
}
