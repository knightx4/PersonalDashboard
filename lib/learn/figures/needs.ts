import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { cosine } from '@/lib/learn/map/layout';
import type { FigureNeed, WantedSpec } from './kinds/wanted';
import { parseFigure } from './registry';
import type { FigureBlock } from './types';

/**
 * The figures lessons asked for and the app cannot draw (plan #2321.9),
 * kept in learn.figure_needs so the ones asked for again get built
 * (plan #2321.10).
 *
 * Each wanted block a lesson stores is one row. Rows that ask for the same
 * thing share a key: a new row embeds its description and takes the key of
 * the closest earlier row of the same need when it is at least
 * `SAME_NEED_SIMILARITY` alike, and its own id otherwise, so the first row
 * of a group is its key. learn.figure_need_groups counts each key's rows.
 * Without an embedding only an identical description joins a group.
 */

/**
 * How alike two descriptions must embed to count as asking for the same
 * figure. A starting point, as the catalogue's floors were: two lessons
 * asking for one chart in different words sit well above it, and two charts
 * of different series on one subject sit below. Erring strict costs a group
 * that counts slower, which the next asks correct; erring loose files one
 * step for two different figures.
 */
export const SAME_NEED_SIMILARITY = 0.85;

/** The need as the matcher reads it: what is missing, then what it would show. */
const NEED_LABEL: Record<FigureNeed, string> = {
  figure_kind: 'A kind of figure',
  data_source: 'A data source',
  model: 'A model',
  map_layer: 'A map layer',
};

export function needText(spec: Pick<WantedSpec, 'need' | 'shows'>): string {
  return `${NEED_LABEL[spec.need]}: ${spec.shows.replace(/\s+/g, ' ').trim()}`;
}

/** A wanted block on a lesson, with its place in the lesson's figures. */
export type WantedFigure = { ordinal: number; caption: string; spec: WantedSpec };

/** The wanted blocks among a lesson's figures, read with the kind's schema. */
export function wantedFigures(figures: readonly FigureBlock[]): WantedFigure[] {
  const wanted: WantedFigure[] = [];
  figures.forEach((block, ordinal) => {
    const drawn = parseFigure(block);
    if (drawn?.kind.data === 'wanted') wanted.push({ ordinal, caption: block.caption, spec: drawn.spec as WantedSpec });
  });
  return wanted;
}

/** An earlier need of the same kind, as the matcher compares it. */
export type KnownNeed = { key: string; text: string; vector: number[] | null };

/**
 * The key a new need joins, or null when it starts a group of its own. The
 * closest vector at or above the floor wins, the earlier on a tie; a need
 * with no vector, or none to compare with, joins only an identical text.
 */
export function matchNeed(
  candidate: { text: string; vector: number[] | null },
  known: readonly KnownNeed[],
  floor: number = SAME_NEED_SIMILARITY,
): string | null {
  const same = (a: string) => a.trim().toLowerCase();
  let best: { key: string; similarity: number } | null = null;
  for (const need of known) {
    if (candidate.vector && need.vector) {
      const similarity = cosine(candidate.vector, need.vector);
      if (similarity >= floor && (!best || similarity > best.similarity)) best = { key: need.key, similarity };
    }
  }
  if (best) return best.key;
  return known.find((need) => same(need.text) === same(candidate.text))?.key ?? null;
}

/** A stored vector as PostgREST returns it, the text `[0.1,…]`, or null. */
export function readVector(value: unknown): number[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  return parsed.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (parsed as number[]) : null;
}

/** Embeds one description as a document; null when no embedding could be made. */
export type EmbedNeed = (text: string) => Promise<{ vector: number[]; model: string } | null>;

/** How many earlier needs of one kind are compared with a new one. */
const KNOWN_LIMIT = 500;

/**
 * Records a stored lesson's wanted blocks. Runs on the service-role client
 * after the lesson is saved, and never fails the lesson: what went wrong
 * comes back as `detail`. A block already recorded for the lesson is left
 * as it is.
 */
export async function recordFigureNeeds(
  learn: LearnSupabaseClient,
  input: { userId: string; subjectId: string | null; cardId: string; figures: readonly FigureBlock[] },
  embed: EmbedNeed,
  newId: () => string = () => crypto.randomUUID(),
): Promise<{ recorded: number; detail?: string }> {
  let recorded = 0;
  for (const wanted of wantedFigures(input.figures)) {
    const text = needText(wanted.spec);
    const embedded = await embed(text).catch(() => null);

    const { data, error } = await learn
      .from('figure_needs')
      .select('key, need, shows, embedding')
      .eq('user_id', input.userId)
      .eq('need', wanted.spec.need)
      .order('created_at', { ascending: true })
      .limit(KNOWN_LIMIT);
    if (error) return { recorded, detail: `Reading earlier figure needs failed: ${error.message}` };
    const known = ((data ?? []) as { key: string; need: FigureNeed; shows: string; embedding: unknown }[]).map((row) => ({
      key: row.key,
      text: needText(row),
      vector: readVector(row.embedding),
    }));

    const id = newId();
    const key = matchNeed({ text, vector: embedded?.vector ?? null }, known) ?? id;
    const { error: insertError } = await learn.from('figure_needs').upsert(
      {
        id,
        user_id: input.userId,
        subject_id: input.subjectId,
        card_id: input.cardId,
        ordinal: wanted.ordinal,
        need: wanted.spec.need,
        shows: wanted.spec.shows,
        why: wanted.spec.why,
        caption: wanted.caption,
        key,
        embedding: embedded ? `[${embedded.vector.join(',')}]` : null,
        embedding_model: embedded?.model ?? null,
      },
      { onConflict: 'card_id,ordinal', ignoreDuplicates: true },
    );
    if (insertError) return { recorded, detail: `Recording a figure need failed: ${insertError.message}` };
    recorded += 1;
  }
  return { recorded };
}
