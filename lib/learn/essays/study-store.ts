import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { passageStore, PASSAGE_MIN_SIMILARITY, toPassages } from '@/lib/vault/notes/passages';
import { vectorForText, type Vectorised } from '@/lib/vault/notes/related';
import type { EssayPin } from './model';
import {
  bestSentence,
  contentWords,
  passageItem,
  pinItems,
  pinKey,
  positionItem,
  POSITION_MIN_SIMILARITY,
  STUDY_PASSAGES,
  STUDY_POSITIONS,
  studyList,
  wordMatches,
  type StudyItem,
  type WordCandidate,
} from './study';

/**
 * The study panel's search (plan #1863.8), through the person's own session
 * so RLS decides what is theirs. lib/learn/essays/study.ts holds the rules;
 * this reads the rows they run over.
 *
 * One embedding of the paragraph, under the `embed-note-match` spend and its
 * cache in obsidian.text_embeddings, searches both the note passages and the
 * positions. A paragraph searched before costs nothing.
 */

/** How many of each kind with no vector are read to match by words. */
const WORD_ROWS = 300;

export type StudySearch = {
  items: StudyItem[];
  /** False when the paragraph could not be embedded, so only word matches were looked for. */
  searched: boolean;
  /** False while none of the person's notes has been split into passages yet. */
  indexed: boolean;
};

type PositionRow = {
  position_id: string;
  name: string;
  statement: string;
  theme_id: string | null;
  path: string;
  quote: string;
  similarity: number;
};

async function nearestPositions(
  vault: VaultSupabaseClient,
  userId: string,
  vector: Vectorised,
): Promise<PositionRow[]> {
  try {
    const { data, error } = await vault.rpc('nearest_positions', {
      query_embedding: vectorLiteral(vector.vector),
      p_user_id: userId,
      match_limit: STUDY_POSITIONS,
      min_similarity: POSITION_MIN_SIMILARITY,
      embedding_model_filter: vector.model,
    });
    if (error) throw new Error(error.message);
    return (data ?? []) as PositionRow[];
  } catch (error) {
    console.error('[essay study] positions', error instanceof Error ? error.message : error);
    return [];
  }
}

async function nearestByMeaning(
  vault: VaultSupabaseClient,
  userId: string,
  core: Pick<CoreSupabaseClient, 'from'> | null,
  paragraph: string,
  exclude: string[],
): Promise<{ passages: StudyItem[]; positions: StudyItem[]; searched: boolean }> {
  const ports = passageStore(vault, userId, { core });
  let vector: Vectorised | null = null;
  try {
    vector = await vectorForText(ports, paragraph);
  } catch (error) {
    console.error('[essay study] embedding', error instanceof Error ? error.message : error);
  }
  if (!vector) return { passages: [], positions: [], searched: false };

  const [blocks, positions] = await Promise.all([
    ports
      .nearestBlocks(vector, {
        limit: STUDY_PASSAGES,
        minSimilarity: PASSAGE_MIN_SIMILARITY,
        exclude,
      })
      .then((rows) => toPassages(rows, PASSAGE_MIN_SIMILARITY))
      .catch((error: unknown) => {
        console.error('[essay study] passages', error instanceof Error ? error.message : error);
        return [];
      }),
    nearestPositions(vault, userId, vector),
  ]);
  return {
    passages: blocks.map((passage) => passageItem(paragraph, passage)),
    positions: positions
      .filter((row) => row.similarity >= POSITION_MIN_SIMILARITY && row.quote)
      .map((row) =>
        positionItem({
          positionId: row.position_id,
          name: row.name,
          statement: row.statement,
          themeId: row.theme_id,
          path: row.path,
          quote: row.quote,
        }),
      ),
    searched: true,
  };
}

type ReadingRow = {
  id: string;
  title: string | null;
  locator_label: string | null;
  text_anchor: string | null;
  note: string | null;
  why: string | null;
};
type CardNoteRow = { id: string; body: string; concept_id: string | null };
type LogRow = {
  id: string;
  subject_id: string | null;
  topic: string;
  question: string | null;
  summary: string | null;
  ideas: { name?: unknown }[] | null;
};
type ClipRow = { id: string; caption: string | null; idea: string | null; serves: string | null };

function rowsOf<T>(
  label: string,
  result: { data: unknown; error: { message: string } | null },
): T[] {
  if (result.error) {
    console.error(`[essay study] ${label}`, result.error.message);
    return [];
  }
  return (result.data ?? []) as T[];
}

/** Readings, card notes, the learning log and saved clips, as candidates to match by words. */
async function wordCandidates(learn: LearnSupabaseClient): Promise<WordCandidate[]> {
  const [readings, cards, log, clips] = await Promise.all([
    learn
      .from('readings')
      .select('id, title, locator_label, text_anchor, note, why')
      .order('updated_at', { ascending: false })
      .limit(WORD_ROWS),
    learn
      .from('card_notes')
      .select('id, body, concept_id')
      .order('created_at', { ascending: false })
      .limit(WORD_ROWS),
    learn
      .from('learning_log')
      .select('id, subject_id, topic, question, summary, ideas')
      .order('created_at', { ascending: false })
      .limit(WORD_ROWS),
    learn
      .from('video_clips')
      .select('id, caption, idea, serves')
      .not('saved_at', 'is', null)
      .order('saved_at', { ascending: false })
      .limit(WORD_ROWS),
  ]);

  const out: WordCandidate[] = [];
  for (const row of rowsOf<ReadingRow>('readings', readings)) {
    out.push({
      key: `reading:${row.id}`,
      kind: 'reading',
      title: row.title?.trim() || 'A reading',
      context: row.locator_label?.trim() || null,
      href: `/learn/r/${row.id}`,
      link: null,
      texts: [row.text_anchor, row.note, row.why],
    });
  }
  for (const row of rowsOf<CardNoteRow>('card notes', cards)) {
    out.push({
      key: `card:${row.id}`,
      kind: 'card',
      title: 'Your note on a card',
      context: null,
      href: row.concept_id ? `/learn/c/${row.concept_id}` : null,
      link: null,
      texts: [row.body],
    });
  }
  for (const row of rowsOf<LogRow>('learning log', log)) {
    const ideas = (row.ideas ?? []).flatMap((idea) =>
      typeof idea?.name === 'string' ? [idea.name] : [],
    );
    out.push({
      key: `log:${row.id}`,
      kind: 'log',
      title: row.topic,
      context: null,
      href: row.subject_id ? `/learn/s/${row.subject_id}` : null,
      link: null,
      texts: [row.summary, row.question, ideas.join('. ')],
    });
  }
  for (const row of rowsOf<ClipRow>('clips', clips)) {
    out.push({
      key: `clip:${row.id}`,
      kind: 'clip',
      title: row.idea?.trim() || row.caption?.trim() || 'A saved clip',
      context: null,
      href: '/learn/clips',
      link: null,
      texts: [row.caption, row.serves],
    });
  }
  return out;
}

/** The card notes' ideas, named, so "Your note on a card" can say which. */
async function nameCards(learn: LearnSupabaseClient, items: StudyItem[]): Promise<StudyItem[]> {
  const ids = [
    ...new Set(
      items.flatMap((item) =>
        item.kind === 'card' && item.href ? [item.href.split('/').pop()!] : [],
      ),
    ),
  ];
  if (ids.length === 0) return items;
  const { data, error } = await learn.from('concepts').select('id, name').in('id', ids);
  if (error) return items;
  const names = new Map(
    ((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
  );
  return items.map((item) => {
    const name =
      item.kind === 'card' && item.href ? names.get(item.href.split('/').pop()!) : undefined;
    return name ? { ...item, title: `Your note on ${name}` } : item;
  });
}

/** Whether any of the person's notes has a passage with a vector yet. */
async function passagesIndexed(vault: VaultSupabaseClient): Promise<boolean> {
  const { data, error } = await vault
    .from('note_blocks')
    .select('id')
    .not('embedding', 'is', null)
    .limit(1);
  return !error && (data ?? []).length > 0;
}

/**
 * What the person has that bears on `paragraph`: the pins first, then vault
 * passages, positions and what matches by words, without the essay's own
 * note and without what they hid for this essay. Never throws for one source
 * failing; that source is left out.
 */
export async function searchStudy(args: {
  learn: LearnSupabaseClient;
  vault: VaultSupabaseClient;
  core: Pick<CoreSupabaseClient, 'from'> | null;
  userId: string;
  paragraph: string;
  essayNoteId: string | null;
  pins: readonly EssayPin[];
  hidden: readonly string[];
}): Promise<StudySearch> {
  const text = args.paragraph.trim();
  const [meaning, candidates, indexed] = await Promise.all([
    text
      ? nearestByMeaning(
          args.vault,
          args.userId,
          args.core,
          text,
          args.essayNoteId ? [args.essayNoteId] : [],
        )
      : Promise.resolve({ passages: [], positions: [], searched: false }),
    wordCandidates(args.learn).catch(() => [] as WordCandidate[]),
    passagesIndexed(args.vault),
  ]);
  const byWords = text ? wordMatches(text, candidates) : [];

  // A pin's row takes its best sentence for this paragraph, whatever it scores.
  const pinKeys = new Set(args.pins.map(pinKey));
  const words = contentWords(text);
  const loaded = new Map<string, StudyItem>();
  for (const { texts, ...candidate } of candidates) {
    if (!pinKeys.has(candidate.key)) continue;
    loaded.set(candidate.key, {
      ...candidate,
      sentence: bestSentence(words, texts)?.sentence ?? null,
      pinned: true,
    });
  }

  const items = studyList(
    pinItems(args.pins, loaded),
    [meaning.passages, meaning.positions, byWords],
    args.hidden,
  );
  return { items: await nameCards(args.learn, items), searched: meaning.searched, indexed };
}
