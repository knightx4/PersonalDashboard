/**
 * What you studied, beside the paragraph you are writing (plan #1863.8;
 * docs/LEARN-ESSAYS-SPEC.md, "From your study").
 *
 * The panel searches with the current paragraph after a pause in typing.
 * Vault passages and positions on the vault map are found by meaning, with
 * one embedding of the paragraph (lib/vault/notes/passages.ts and
 * obsidian.nearest_positions). Readings, clips, card notes and the learning
 * log have no vectors, and there are few of them, so they are matched here
 * by the words they share with the paragraph. Either way an item below its
 * floor is not shown, and no score is.
 *
 * Each item carries the sentence that matched, so you can see why it is
 * there, and what pressing it inserts: a `[[link]]` when it lives in the
 * vault, and the sentence as a quote, which the editor marks `*` with the
 * source's name.
 *
 * Nothing here touches the database, so it is tested and drawn in the gallery
 * from fixtures.
 */

import type { EssayPin, PinKind } from './model';

/** How long the panel waits after the last keystroke before it searches. */
export const STUDY_PAUSE_MS = 2_000;

/** The most items the panel lists below the pinned ones. */
export const STUDY_SHOWN = 6;

/** The most of each kind found by meaning. */
export const STUDY_PASSAGES = 3;
export const STUDY_POSITIONS = 2;

/** The position floor: a statement is one sentence, so it scores a little lower than a passage. */
export const POSITION_MIN_SIMILARITY = 0.5;

/** The share of the paragraph's words an item's sentence must hold to count as matching. */
export const WORDS_MIN_OVERLAP = 0.25;
/** And at least this many words in common, so one shared word never matches. */
export const WORDS_MIN_SHARED = 2;

/** The longest sentence shown and quoted. */
export const SENTENCE_MAX = 280;

export type StudyKind =
  | 'passage'
  | 'position'
  | 'reading'
  | 'clip'
  | 'card'
  | 'log'
  | 'goal'
  | 'theme';

export type StudyItem = {
  /** Stable for the item across searches; what hiding it stores. */
  key: string;
  kind: StudyKind;
  title: string;
  /** Where in its source it sits: a heading path, a reading's pages, a position's theme. */
  context: string | null;
  /** The sentence that matched; null for a pin with nothing to quote. */
  sentence: string | null;
  /** Its page in the app, or null when it has none. */
  href: string | null;
  /** The vault note to link, as `[[name]]` takes it, or null when it is not in the vault. */
  link: string | null;
  /** Pinned to the brief: listed first whatever the paragraph says. */
  pinned: boolean;
};

/** What a kind is called on its row. */
export const STUDY_KIND_LABELS: Record<StudyKind, string> = {
  passage: 'Note',
  position: 'Position',
  reading: 'Reading',
  clip: 'Clip',
  card: 'Card note',
  log: 'Learning log',
  goal: 'Goal',
  theme: 'Theme',
};

/** Words too common to say two texts are about the same thing. */
const STOP = new Set(
  (
    'about above after again against also although among another because been before being below between both ' +
    'cannot could does doing down during each even every from further have having here hers herself himself ' +
    'into itself just know like made make many more most much must myself never only other ought ours ourselves ' +
    'over own same says should since some such than that their theirs them themselves then there these they ' +
    'thing things think this those though through thus under until upon very want were what when where whether ' +
    'which while whom whose will with within without would your yours yourself yourselves really still well ' +
    'something someone anything nothing everything people way ways seem seems'
  ).split(' '),
);

/** A word cut to a rough stem, so "markets" meets "market" and "priced" meets "price". */
function stem(word: string): string {
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The words that carry what a text is about: four letters or more, not common, stemmed. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
    const word = raw.replace(/['’]s$/u, '');
    if (word.length < 4 || STOP.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

/** The sentences of a text, markdown list and quote markers taken off. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const plain = line.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, '').trim();
    if (!plain) continue;
    for (const part of plain.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“'‘(])/u)) {
      const sentence = part.trim();
      if (/[\p{L}\p{N}]/u.test(sentence)) out.push(sentence);
    }
  }
  return out;
}

function shared(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0;
  for (const word of b) if (a.has(word)) n += 1;
  return n;
}

/** A sentence cut to SENTENCE_MAX at a word, with an ellipsis when cut. */
export function clip(sentence: string): string {
  const flat = sentence.replace(/\s+/g, ' ').trim();
  if (flat.length <= SENTENCE_MAX) return flat;
  const cut = flat.slice(0, SENTENCE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > SENTENCE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * The sentence of `texts` sharing the most words with the paragraph, and how
 * many it shares. The first sentence, sharing none, when nothing does.
 */
export function bestSentence(
  paragraph: ReadonlySet<string>,
  texts: readonly (string | null | undefined)[],
): { sentence: string; shared: number } | null {
  let best: { sentence: string; shared: number } | null = null;
  for (const text of texts) {
    if (!text) continue;
    for (const sentence of sentences(text)) {
      const n = shared(paragraph, contentWords(sentence));
      if (!best || n > best.shared) best = { sentence, shared: n };
    }
  }
  return best ? { sentence: clip(best.sentence), shared: best.shared } : null;
}

/** Something with no vector, to be matched by the words it shares with the paragraph. */
export type WordCandidate = Omit<StudyItem, 'sentence' | 'pinned'> & {
  /** Its texts, in the order a sentence is preferred from. */
  texts: (string | null | undefined)[];
};

/**
 * The candidates whose best sentence shares enough of the paragraph's words,
 * most shared first. Enough is WORDS_MIN_SHARED words and WORDS_MIN_OVERLAP of
 * the paragraph's, capped at five so a long paragraph is not harder to match.
 */
export function wordMatches(paragraph: string, candidates: readonly WordCandidate[]): StudyItem[] {
  const words = contentWords(paragraph);
  if (words.size === 0) return [];
  const needed = Math.max(WORDS_MIN_SHARED, Math.min(5, Math.ceil(words.size * WORDS_MIN_OVERLAP)));
  const found: { item: StudyItem; shared: number }[] = [];
  for (const { texts, ...candidate } of candidates) {
    const best = bestSentence(words, texts);
    if (!best || best.shared < needed) continue;
    found.push({
      item: { ...candidate, sentence: best.sentence, pinned: false },
      shared: best.shared,
    });
  }
  return found.sort((a, b) => b.shared - a.shared).map((entry) => entry.item);
}

/** The note's name as `[[…]]` takes it: the file name without its folder or `.md`. */
export function wikilinkTarget(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

/** What the editor inserts for a link to the item's note. */
export function linkText(item: Pick<StudyItem, 'link'>): string | null {
  return item.link ? `[[${item.link}]]` : null;
}

/** What the editor inserts for a quote: the sentence in quotation marks. */
export function quoteText(item: Pick<StudyItem, 'sentence'>): string | null {
  return item.sentence ? `“${item.sentence}”` : null;
}

/** The name a quote is marked with in the authorship block: `*<name>`. */
export function quoteSource(item: Pick<StudyItem, 'title' | 'link'>): string {
  return item.link ?? item.title;
}

/** A passage's key: its note and heading, which survive the note being split again. */
export function passageKey(noteId: string, headingPath: readonly string[]): string {
  return `passage:${noteId}:${headingPath.join(' > ')}`;
}

/** A vault passage as a study item, with the sentence of it nearest the paragraph's words. */
export function passageItem(
  paragraph: string,
  passage: {
    noteId: string;
    path: string;
    title: string;
    headingPath: string[];
    text: string;
    href: string;
  },
): StudyItem {
  const body = passage.text.replace(/^#{1,6}\s.*\n?/, '');
  const best = bestSentence(contentWords(paragraph), [body || passage.text]);
  return {
    key: passageKey(passage.noteId, passage.headingPath),
    kind: 'passage',
    title: passage.title,
    context: passage.headingPath.length > 0 ? passage.headingPath.join(' › ') : null,
    sentence: best?.sentence ?? null,
    href: passage.href,
    link: wikilinkTarget(passage.path),
    pinned: false,
  };
}

/** A position from the vault map, with its checked quote as the sentence. */
export function positionItem(row: {
  positionId: string;
  name: string;
  statement: string;
  themeId: string | null;
  path: string;
  quote: string;
}): StudyItem {
  return {
    key: `position:${row.positionId}`,
    kind: 'position',
    title: row.name,
    context: row.statement,
    sentence: clip(row.quote),
    href: row.themeId ? `/vault/map/${row.themeId}` : null,
    link: wikilinkTarget(row.path),
    pinned: false,
  };
}

const PIN_STUDY_KIND: Record<PinKind, StudyKind> = {
  goal: 'goal',
  reading: 'reading',
  theme: 'theme',
  log: 'log',
};

/** The key a pin's item has, the same as the item found by search for that row. */
export function pinKey(pin: EssayPin): string {
  return `${PIN_STUDY_KIND[pin.kind]}:${pin.id}`;
}

/**
 * The pins as items. A pin whose row a search loaded takes that row's
 * sentence and link; the rest are listed by title alone.
 */
export function pinItems(
  pins: readonly EssayPin[],
  loaded: ReadonlyMap<string, StudyItem>,
): StudyItem[] {
  return pins.map((pin) => {
    const key = pinKey(pin);
    const found = loaded.get(key);
    if (found) return { ...found, pinned: true };
    return {
      key,
      kind: PIN_STUDY_KIND[pin.kind],
      title: pin.title,
      context: null,
      sentence: null,
      href:
        pin.kind === 'theme'
          ? `/vault/map/${pin.id}`
          : pin.kind === 'reading'
            ? `/learn/r/${pin.id}`
            : null,
      link: null,
      pinned: true,
    };
  });
}

/**
 * What the panel lists: the pins first, then what the search found, the
 * passages and positions interleaved with what matched by words, without
 * repeats and without anything hidden for this essay, at most STUDY_SHOWN
 * below the pins.
 */
export function studyList(
  pins: readonly StudyItem[],
  found: readonly StudyItem[][],
  hidden: readonly string[],
): StudyItem[] {
  const skip = new Set(hidden);
  const seen = new Set<string>();
  const out: StudyItem[] = [];
  for (const pin of pins) {
    if (seen.has(pin.key)) continue;
    seen.add(pin.key);
    out.push(pin);
  }
  let below = 0;
  const longest = Math.max(0, ...found.map((list) => list.length));
  for (let i = 0; i < longest && below < STUDY_SHOWN; i += 1) {
    for (const list of found) {
      const item = list[i];
      if (!item || seen.has(item.key) || skip.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
      below += 1;
      if (below >= STUDY_SHOWN) break;
    }
  }
  return out;
}

/**
 * The paragraph the search reads: the one the cursor is in, or failing that
 * the last one before the cursor (on the blank line after it, or in the
 * heading below), or the first. Null when the essay has none long enough.
 */
export function paragraphNear<P extends { from: number; to: number; text: string }>(
  paragraphs: readonly P[],
  pos: number,
): P | null {
  const inside = paragraphs.find((p) => pos >= p.from && pos <= p.to);
  if (inside) return inside;
  const before = paragraphs.filter((p) => p.to <= pos);
  return before[before.length - 1] ?? paragraphs[0] ?? null;
}

/**
 * The text to search with for the interview's fourth question, "What made
 * you think this?": the question and the answer so far.
 */
export function briefSearchText(brief: { question: string; claim: string }): string {
  return [brief.question, brief.claim]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** A line for the answer box from an item: where it came from, and its sentence. */
export function originLine(item: Pick<StudyItem, 'kind' | 'title' | 'sentence'>): string {
  const from = `${STUDY_KIND_LABELS[item.kind]} “${item.title}”`;
  return item.sentence ? `${from}: ${item.sentence}` : from;
}
