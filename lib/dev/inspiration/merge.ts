import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import type { EmbeddingClient } from '@/lib/learn/embed/voyage';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { cosine } from '@/lib/news/issues/repeats';
import { MODELS } from '@/lib/core/models';

/**
 * Merging takeaways that make the same point, and naming the plan feature or
 * idea that already covers one (plan #1410, under #1406).
 *
 * Runs after the videos are read and stored, over every takeaway that has no
 * vector yet, which is the ones the read just stored. Each is embedded, then
 * compared with the takeaways already embedded and with the ideas and plan
 * features. When the closest of them are near enough to be worth asking about,
 * one short Haiku pass says whether the new takeaway is the same idea as one
 * of the takeaways, and whether a feature or idea already covers it.
 *
 * - The same idea as an earlier takeaway: the new one's video link moves onto
 *   the earlier one, keeping that video's own wording in `said`, and the new
 *   row goes. The takeaway keeps whichever wording the pass found clearer.
 * - Covered: the takeaway is marked `covered` with the feature or idea, so the
 *   tab can say "already in the plan as #N" instead of offering to craft it.
 * - Neither: its vector is stored and it becomes something later takeaways
 *   are compared with.
 *
 * Embedding is what makes this a sweep rather than a one-off: a takeaway with
 * no vector has not been through the pass. If the key is missing or a call
 * fails, the takeaways stay as they are and the next run takes them up.
 *
 * Word overlap (lib/ideas/duplicate.ts) is not used here: two creators rarely
 * say the same thing in the same words.
 */

/**
 * The thresholds. The first real run (3 October 2026, 12 videos, 61
 * takeaways) put every takeaway's nearest neighbour between 0.64 and 0.82,
 * with distinct ideas as close as true repeats, so the floors only keep
 * unrelated rows out of the prompt and the pass decides. That run marked 36
 * of the 61 covered, most of them by features that only touch the same
 * area, which is why a cover now has to quote the row (`coverQuote`).
 */
/** The short pass that says whether two takeaways are one idea. */
export const MERGE_MODEL = MODELS.inspirationMerge;
/** How many of the nearest takeaways are put to the pass. */
export const MERGE_NEIGHBOURS = 3;
/** Cosine similarity below which two takeaways are never asked about. */
export const MERGE_FLOOR = 0.55;
/** How many of the nearest plan features and ideas are put to the pass. */
export const COVER_NEIGHBOURS = 3;
/** Cosine similarity below which a feature or idea is never asked about. */
export const COVER_FLOOR = 0.5;
/** Characters of a plan feature or idea that are embedded and shown. */
export const COVER_TEXT_CHARS = 1_500;

const TOOL = 'report_match';

export type MergeOperation = 'embed-inspiration-takeaways' | 'merge-inspiration-takeaways';

/** A takeaway with no vector yet, which is one the pass has not seen. */
export type FreshTakeaway = {
  id: string;
  title: string;
  body: string;
  module: string | null;
  /** The inspiration_videos row ids it is linked to. */
  videoIds: string[];
};

/** A takeaway the pass has already seen, with its vector. */
export type KnownTakeaway = FreshTakeaway & { status: string; vector: number[] };

/** Something already filed that may cover a takeaway. */
export type CoverRow =
  | { kind: 'plan'; id: string; number: number; text: string }
  | { kind: 'idea'; id: string; text: string };

/** What the pass touches, narrowed so a test can hold it in memory. */
export type MergeStore = {
  fresh(userId: string): Promise<FreshTakeaway[]>;
  known(userId: string): Promise<KnownTakeaway[]>;
  coverRows(userId: string): Promise<CoverRow[]>;
  saveVector(userId: string, takeawayId: string, vector: number[], model: string): Promise<void>;
  /**
   * Move `fromId`'s video links onto `intoId` and remove `fromId`. With
   * `wording`, `intoId` takes that title, body, workspace and vector.
   */
  mergeInto(
    userId: string,
    fromId: string,
    intoId: string,
    wording: { title: string; body: string; module: string | null; vector: number[]; model: string } | null,
  ): Promise<void>;
  markCovered(userId: string, takeawayId: string, by: CoverRow): Promise<void>;
};

export type MergeOptions = {
  anthropicApiKey: string;
  client?: Pick<Anthropic, 'messages'>;
  /** Falls back to EMBEDDING_API_KEY. */
  embeddingApiKey?: string | null;
  /** Injected by the tests. */
  embed?: EmbeddingClient;
  deadline?: number;
  onSpend?: (report: SpendReport, operation: MergeOperation) => void;
};

export type MergeResult = {
  /** Takeaways the pass looked at. */
  seen: number;
  /** Takeaways folded into an earlier one. */
  merged: number;
  /** Takeaways found covered by a plan feature or an idea. */
  covered: number;
  /** Set when the pass stopped before it saw every new takeaway. */
  stopped: string | null;
};

export const takeawayText = (row: { title: string; body: string }) => `${row.title}\n\n${row.body}`;

/** The `k` nearest of `rows` at or above `floor`, nearest first. */
export function nearest<T>(vector: number[], rows: { row: T; vector: number[] }[], k: number, floor: number): T[] {
  return rows
    .map(({ row, vector: other }) => ({ row, score: cosine(vector, other) }))
    .filter((entry) => entry.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.row);
}

const SYSTEM = `You keep a list of ideas taken from videos about building an app with an AI
builder. A new idea has come in. Say two things.

1. Whether it is the same idea as one of the earlier ideas listed as T1, T2...
   The same idea means building one would build the other, even when the
   words differ. A related idea, a narrower or broader one, one sharing a
   theme (both about checking work, both about planning first), or one about
   the same part of the app that would change something different, is not
   the same. When it is the same, say which wording is clearer: the new one
   or the earlier one.

2. Whether something already filed, listed as C1, C2..., covers it: a plan
   feature or an idea that, once built, would do what the new idea asks.
   Touching the same area, the same workspace or the same kind of data is
   not covering it, and neither is making the idea easier to build. Most new
   ideas are not covered. When one is, copy into cover_quote the sentence of
   that row that says it does what the new idea asks, word for word. If no
   sentence says so, it is not covered.

When unsure, answer none.`;

const replySchema = z.object({
  same_as: z.string().default('none'),
  clearer: z.enum(['new', 'earlier']).catch('earlier').default('earlier'),
  covered_by: z.string().default('none'),
  cover_quote: z.string().catch('').default(''),
});

export type Judgement = { sameAs: number | null; newIsClearer: boolean; coveredBy: number | null };

/** The prompt for one new takeaway and its neighbours. */
export function matchPrompt(fresh: FreshTakeaway, earlier: FreshTakeaway[], cover: CoverRow[]): string {
  const lines = ['New idea:', takeawayText(fresh), ''];
  lines.push('Earlier ideas:');
  if (earlier.length === 0) lines.push('(none)');
  earlier.forEach((row, i) => lines.push(`T${i + 1}: ${takeawayText(row).replace(/\n+/g, ' ')}`));
  lines.push('', 'Already filed:');
  if (cover.length === 0) lines.push('(none)');
  cover.forEach((row, i) =>
    lines.push(
      `C${i + 1}: ${row.kind === 'plan' ? `Plan feature #${row.number}` : 'Idea'}: ${row.text.replace(/\n+/g, ' ')}`,
    ),
  );
  lines.push('', `Call ${TOOL}.`);
  return lines.join('\n');
}

/** Lower case, one space, plain quotes: a quote copied from a row survives the round trip. */
const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Shortest quote that counts as the row saying it does what the idea asks. */
export const COVER_QUOTE_MIN = 20;

/**
 * Whether `quote` is in `text`. A cover the pass cannot back with the row's
 * own words is a guess, and a covered takeaway has nothing to press, so a
 * wrong guess hides the takeaway.
 */
export function coverQuote(quote: string, text: string): boolean {
  const wanted = squash(quote).replace(/^["']|["']$/g, '').replace(/[.…]+$/, '');
  return wanted.length >= COVER_QUOTE_MIN && squash(text).includes(wanted);
}

/**
 * The pass's reply as indexes into the lists it was shown. Anything
 * unreadable is none, and so is a cover whose quote is not in that row.
 */
export function readJudgement(input: unknown, earlier: number, cover: string[]): Judgement {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return { sameAs: null, newIsClearer: false, coveredBy: null };
  const pick = (value: string, prefix: string, count: number) => {
    const match = value.trim().toUpperCase().match(new RegExp(`^${prefix}(\\d+)$`));
    if (!match) return null;
    const index = Number(match[1]) - 1;
    return index >= 0 && index < count ? index : null;
  };
  return {
    sameAs: pick(parsed.data.same_as, 'T', earlier),
    newIsClearer: parsed.data.clearer === 'new',
    coveredBy: (() => {
      const index = pick(parsed.data.covered_by, 'C', cover.length);
      return index !== null && coverQuote(parsed.data.cover_quote, cover[index]) ? index : null;
    })(),
  };
}

/** One Haiku call. Throws when the call itself fails, so the pass stops and tries again next run. */
async function judge(
  client: Pick<Anthropic, 'messages'>,
  fresh: FreshTakeaway,
  earlier: FreshTakeaway[],
  cover: CoverRow[],
  onSpend: (report: SpendReport) => void,
): Promise<Judgement> {
  const labels = (prefix: string, count: number) => ['none', ...Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`)];
  const response = await client.messages.create({
    model: MERGE_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    tools: [
      {
        name: TOOL,
        description: 'Report whether the new idea repeats an earlier one, and what already covers it.',
        input_schema: {
          type: 'object',
          properties: {
            same_as: { type: 'string', enum: labels('T', earlier.length) },
            clearer: { type: 'string', enum: ['new', 'earlier'] },
            covered_by: { type: 'string', enum: labels('C', cover.length) },
            cover_quote: {
              type: 'string',
              description: 'The covering row’s sentence, word for word. Empty when covered_by is none.',
            },
          },
          required: ['same_as', 'clearer', 'covered_by', 'cover_quote'],
        },
      },
    ],
    tool_choice: forceTool(TOOL),
    messages: [{ role: 'user', content: matchPrompt(fresh, earlier, cover) }],
  });
  onSpend({ model: MERGE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL);
  if (!block || block.type !== 'tool_use') return { sameAs: null, newIsClearer: false, coveredBy: null };
  return readJudgement(
    block.input,
    earlier.length,
    cover.map((row) => row.text),
  );
}

/** Merge and check every takeaway one person has with no vector yet. */
export async function mergeNewTakeaways(store: MergeStore, userId: string, options: MergeOptions): Promise<MergeResult> {
  const result: MergeResult = { seen: 0, merged: 0, covered: 0, stopped: null };
  const fresh = await store.fresh(userId);
  if (fresh.length === 0) return result;

  const [known, cover] = await Promise.all([store.known(userId), store.coverRows(userId)]);
  const embedded: EmbedOutcome = await embedTexts({
    texts: [...fresh.map(takeawayText), ...cover.map((row) => row.text)],
    apiKey: options.embeddingApiKey,
    client: options.embed,
    onSpend: (report) => options.onSpend?.(report, 'embed-inspiration-takeaways'),
  });
  if (!embedded.ok) {
    result.stopped = `embedding the takeaways failed (${embedded.reason}): ${embedded.detail}`;
    return result;
  }
  const freshVectors = embedded.vectors.slice(0, fresh.length);
  const coverVectors = cover.map((row, i) => ({ row, vector: embedded.vectors[fresh.length + i] }));
  const client = options.client ?? new Anthropic({ apiKey: options.anthropicApiKey });

  for (const [i, takeaway] of fresh.entries()) {
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      result.stopped = 'out of time; the next run carries on';
      break;
    }
    const vector = freshVectors[i];
    // Two takeaways from one video never make the same point, and a link from
    // the same video could not move onto the other.
    const others = known
      .filter((row) => !row.videoIds.some((id) => takeaway.videoIds.includes(id)))
      .map((row) => ({ row, vector: row.vector }));
    const earlier = nearest(vector, others, MERGE_NEIGHBOURS, MERGE_FLOOR);
    const covering = nearest(vector, coverVectors, COVER_NEIGHBOURS, COVER_FLOOR);

    let judgement: Judgement = { sameAs: null, newIsClearer: false, coveredBy: null };
    if (earlier.length > 0 || covering.length > 0) {
      try {
        judgement = await judge(client, takeaway, earlier, covering, (report) =>
          options.onSpend?.(report, 'merge-inspiration-takeaways'),
        );
      } catch (failure) {
        result.stopped = `the merge pass failed: ${failure instanceof Error ? failure.message : String(failure)}`;
        break;
      }
    }
    result.seen += 1;
    const coveredBy = judgement.coveredBy === null ? null : covering[judgement.coveredBy];

    if (judgement.sameAs !== null) {
      const into = earlier[judgement.sameAs];
      // A takeaway two videos already share keeps its wording: rewording it
      // to each newcomer let it drift until a third video matched words the
      // first two never said.
      const wording = judgement.newIsClearer && into.videoIds.length < 2
        ? { title: takeaway.title, body: takeaway.body, module: takeaway.module, vector, model: embedded.model }
        : null;
      await store.mergeInto(userId, takeaway.id, into.id, wording);
      into.videoIds.push(...takeaway.videoIds);
      if (wording) Object.assign(into, { title: wording.title, body: wording.body, module: wording.module, vector });
      result.merged += 1;
      if (coveredBy && into.status === 'open') {
        await store.markCovered(userId, into.id, coveredBy);
        into.status = 'covered';
        result.covered += 1;
      }
      continue;
    }

    await store.saveVector(userId, takeaway.id, vector, embedded.model);
    let status = 'open';
    if (coveredBy) {
      await store.markCovered(userId, takeaway.id, coveredBy);
      status = 'covered';
      result.covered += 1;
    }
    known.push({ ...takeaway, videoIds: [...takeaway.videoIds], status, vector });
  }
  return result;
}

/** pgvector comes back over PostgREST as the text `[0.1,0.2,…]`. */
function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

/** The store over the service-role client, every query filtered by the person. */
export function supabaseMergeStore(learn: LearnSupabaseClient): MergeStore {
  const db = learn.schema('public');
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };

  async function videoIdsByTakeaway(userId: string): Promise<Map<string, string[]>> {
    const { data, error } = await db.from('inspiration_takeaway_videos').select('takeaway_id, video_id').eq('user_id', userId);
    fail('Reading the takeaways’ videos', error);
    const map = new Map<string, string[]>();
    for (const row of (data ?? []) as { takeaway_id: string; video_id: string }[]) {
      map.set(row.takeaway_id, [...(map.get(row.takeaway_id) ?? []), row.video_id]);
    }
    return map;
  }

  type Row = { id: string; title: string; body: string; module: string | null; status: string; embedding: unknown };

  return {
    async fresh(userId) {
      const [rows, links] = await Promise.all([
        db
          .from('inspiration_takeaways')
          .select('id, title, body, module')
          .eq('user_id', userId)
          .eq('status', 'open')
          .is('embedding', null)
          .order('created_at', { ascending: true }),
        videoIdsByTakeaway(userId),
      ]);
      fail('Reading the new takeaways', rows.error);
      return ((rows.data ?? []) as Omit<Row, 'status' | 'embedding'>[]).map((row) => ({
        ...row,
        videoIds: links.get(row.id) ?? [],
      }));
    },

    async known(userId) {
      const [rows, links] = await Promise.all([
        db
          .from('inspiration_takeaways')
          .select('id, title, body, module, status, embedding')
          .eq('user_id', userId)
          .not('embedding', 'is', null),
        videoIdsByTakeaway(userId),
      ]);
      fail('Reading the earlier takeaways', rows.error);
      const out: KnownTakeaway[] = [];
      for (const row of (rows.data ?? []) as Row[]) {
        const vector = parseVector(row.embedding);
        if (!vector) continue;
        out.push({ id: row.id, title: row.title, body: row.body, module: row.module, status: row.status, vector, videoIds: links.get(row.id) ?? [] });
      }
      return out;
    },

    async coverRows(userId) {
      const [features, ideas] = await Promise.all([
        // Every feature that was not dropped: one already built covers an
        // idea as surely as one still to build.
        db
          .from('plan_items')
          .select('id, number, title, acceptance, detail')
          .eq('user_id', userId)
          .is('parent_id', null)
          .eq('kind', 'build')
          .neq('status', 'dropped')
          .is('dismissed_at', null),
        // An idea that became a feature is covered by the feature.
        db.from('ideas').select('id, body').eq('user_id', userId).is('dismissed_at', null).is('plan_item_id', null),
      ]);
      fail('Reading the plan features', features.error);
      fail('Reading the ideas', ideas.error);
      const cut = (parts: (string | null)[]) => parts.filter(Boolean).join('\n\n').slice(0, COVER_TEXT_CHARS);
      const rows: CoverRow[] = [];
      for (const row of (features.data ?? []) as { id: string; number: number; title: string; acceptance: string | null; detail: string | null }[]) {
        rows.push({ kind: 'plan', id: row.id, number: row.number, text: cut([row.title, row.acceptance, row.detail]) });
      }
      for (const row of (ideas.data ?? []) as { id: string; body: string }[]) {
        if (row.body.trim()) rows.push({ kind: 'idea', id: row.id, text: cut([row.body]) });
      }
      return rows;
    },

    async saveVector(userId, takeawayId, vector, model) {
      const { error } = await db
        .from('inspiration_takeaways')
        .update({ embedding: vectorLiteral(vector), embedding_model: model })
        .eq('user_id', userId)
        .eq('id', takeawayId);
      fail('Storing a takeaway’s vector', error);
    },

    async mergeInto(userId, fromId, intoId, wording) {
      const links = await db
        .from('inspiration_takeaway_videos')
        .select('video_id, said, quote, start_seconds')
        .eq('user_id', userId)
        .eq('takeaway_id', fromId);
      fail('Reading the merged takeaway’s videos', links.error);
      const moved = ((links.data ?? []) as { video_id: string; said: string | null; quote: string | null; start_seconds: number | null }[]).map(
        (row) => ({ ...row, takeaway_id: intoId, user_id: userId }),
      );
      if (moved.length > 0) {
        const { error } = await db
          .from('inspiration_takeaway_videos')
          .upsert(moved, { onConflict: 'takeaway_id,video_id', ignoreDuplicates: true });
        fail('Linking the videos to the earlier takeaway', error);
      }
      const gone = await db.from('inspiration_takeaways').delete().eq('user_id', userId).eq('id', fromId);
      fail('Removing the merged takeaway', gone.error);
      if (wording) {
        const { error } = await db
          .from('inspiration_takeaways')
          .update({
            title: wording.title,
            body: wording.body,
            module: wording.module,
            embedding: vectorLiteral(wording.vector),
            embedding_model: wording.model,
          })
          .eq('user_id', userId)
          .eq('id', intoId);
        fail('Rewording the earlier takeaway', error);
      }
    },

    async markCovered(userId, takeawayId, by) {
      const { error } = await db
        .from('inspiration_takeaways')
        .update({ status: 'covered', ...(by.kind === 'plan' ? { plan_item_id: by.id } : { idea_id: by.id }) })
        .eq('user_id', userId)
        .eq('id', takeawayId)
        .eq('status', 'open');
      fail('Marking a takeaway covered', error);
    },
  };
}
