import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MODELS } from '@/lib/core/models';
import { FIGURE_KINDS, readStoredFigures, readWrittenFigures } from './registry';
import { resolveFigures } from './resolve';
import type { FigureBlock, FigureResolveContext } from './types';

/**
 * A kind that lands fills the lessons that asked for it (plan #2321.11).
 *
 * A stage of the daily cron looks for figure needs (`./needs.ts`) whose plan
 * step (`./need-steps.ts`) is done, so the kind, source, model or map layer
 * it asked for is in the registry. For each lesson still showing the wanted
 * block it asks the writer for that one block alone, with the lesson and
 * every kind's writer line as context, and replaces the wanted block on the
 * card. The need row is marked served with the kind and the date. A block
 * the writer cannot fill, or whose data a registered source does not hold,
 * stays wanted with the reason on the need row, and is tried again after
 * `RETRY_AFTER_DAYS` in case the build had not deployed yet.
 */

export const BACKFILL_MODEL = MODELS.learnWriteLesson;

/** Blocks filled per run; the rest wait for tomorrow. */
export const MAX_BLOCKS_PER_RUN = 10;

/** How long a block the writer could not fill waits before it is tried again. */
export const RETRY_AFTER_DAYS = 3;

const TOOL_NAME = 'report_figure';

/** The lesson around the block the writer is asked to fill. */
export type BackfillLesson = {
  name: string;
  hook: string | null;
  summary: string | null;
  takeaway: string | null;
  example: string | null;
};

export type BackfillWanted = { need: string; shows: string; why: string; caption: string };

export type BackfillWrite =
  | { ok: true; block: FigureBlock; failed?: undefined }
  /** The writer looked and the figure cannot be made: kept wanted, with why. */
  | { ok: false; reason: string; failed?: undefined }
  /** The call did not happen or could not be read: nothing is recorded, a later run tries again. */
  | { ok: false; failed: string; reason?: undefined };

function oneLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The writer's kinds with `wanted` left out: a wanted block cannot fill a wanted block. */
export function backfillKindLines(): string {
  return FIGURE_KINDS.filter((kind) => kind.data !== 'wanted')
    .map((kind) => `- ${kind.writerLine}`)
    .join('\n');
}

export function backfillPrompt(lesson: BackfillLesson, wanted: BackfillWanted): string {
  return [
    'A lesson in a learning feed asked for a figure the app could not draw then. The app can draw more now. Write that one figure, or say it cannot be made.',
    '',
    `Lesson: ${oneLine(lesson.name)}`,
    lesson.hook ? `Hook: ${oneLine(lesson.hook)}` : '',
    lesson.takeaway ? `Takeaway: ${oneLine(lesson.takeaway)}` : '',
    lesson.summary ? `Summary: ${oneLine(lesson.summary)}` : '',
    lesson.example ? `Example: ${oneLine(lesson.example)}` : '',
    '',
    'The lesson wanted this, in its own words:',
    `- It would show: ${oneLine(wanted.shows)}`,
    `- Because: ${oneLine(wanted.why)}`,
    `- Its caption was: ${oneLine(wanted.caption)}`,
    '',
    'Choose the kind that draws it, and write its spec exactly as the kind asks. caption is one sentence saying what the figure shows; keep the old one when it still fits. Lay out only facts the lesson already uses or ones as well established, and when the figure takes data from a source, name only a series you are sure that source holds. When no kind below can draw it, or you cannot vouch for the data, set can_draw to false and say why in one sentence in reason.',
    '',
    'The kinds, and the spec each takes:',
    backfillKindLines(),
    '',
    `Call ${TOOL_NAME}.`,
  ]
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n');
}

/** Asks the writer for one block, and reads it with the registry. */
export async function writeBackfillBlock(input: {
  client: Pick<Anthropic, 'messages'>;
  lesson: BackfillLesson;
  wanted: BackfillWanted;
  onSpend?: (report: SpendReport) => void;
}): Promise<BackfillWrite> {
  const kinds = FIGURE_KINDS.filter((kind) => kind.data !== 'wanted').map((kind) => kind.id);
  let response;
  try {
    response = await input.client.messages.create({
      model: BACKFILL_MODEL,
      max_tokens: 2048 + THINKING_ROOM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the figure, or that it cannot be made.',
          input_schema: {
            type: 'object',
            properties: {
              can_draw: { type: 'boolean' },
              reason: { type: ['string', 'null'], description: 'One sentence on why the figure cannot be made. Null when it can.' },
              kind: { type: ['string', 'null'], enum: [...kinds, null] },
              caption: { type: ['string', 'null'], description: 'One sentence saying what the figure shows.' },
              spec: { type: ['object', 'null'], description: 'The shape the kind takes, as the instructions give it.' },
            },
            required: ['can_draw', 'reason', 'kind', 'caption', 'spec'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, BACKFILL_MODEL),
      messages: [{ role: 'user', content: backfillPrompt(input.lesson, input.wanted) }],
    });
  } catch (error) {
    return { ok: false, failed: error instanceof Error ? error.message : 'The figure call failed.' };
  }
  input.onSpend?.({ model: BACKFILL_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((piece) => piece.type === 'tool_use' && piece.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, failed: whyNoReport(response) };
  const report = block.input as { can_draw?: unknown; reason?: unknown; kind?: unknown; caption?: unknown; spec?: unknown };
  if (report.can_draw !== true) {
    const reason = oneLine(typeof report.reason === 'string' ? report.reason : '');
    return { ok: false, reason: reason || 'The writer could not make the figure.' };
  }
  const [written] = readWrittenFigures([{ kind: report.kind, caption: report.caption, spec: report.spec }]);
  if (!written || written.kind === 'wanted') return { ok: false, reason: 'The writer’s figure did not fit the kind it chose.' };
  return { ok: true, block: written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicDb = SupabaseClient<any, 'public'>;

export type NeedRow = {
  id: string;
  user_id: string;
  card_id: string;
  ordinal: number;
  need: string;
  shows: string;
  why: string;
  caption: string;
  key: string;
  tried_at: string | null;
};

type CardRow = {
  id: string;
  idea_name: string | null;
  hook: string | null;
  summary: string | null;
  takeaway: string | null;
  example: string | null;
  figures: unknown;
};

export type BackfillResult = {
  considered: number;
  served: { needId: string; cardId: string; kind: string }[];
  kept: { needId: string; reason: string }[];
  failed: { needId: string; detail: string }[];
};

/** Needs not tried lately, the longest untried first, up to the cap. */
export function dueNeeds(rows: readonly NeedRow[], now: Date, limit: number = MAX_BLOCKS_PER_RUN): NeedRow[] {
  const cutoff = now.getTime() - RETRY_AFTER_DAYS * 86_400_000;
  return rows
    .filter((row) => !row.tried_at || new Date(row.tried_at).getTime() <= cutoff)
    .sort((a, b) => (a.tried_at ?? '').localeCompare(b.tried_at ?? ''))
    .slice(0, limit);
}

/**
 * Fills the wanted blocks whose figure has been built. Never throws for one
 * block: what went wrong comes back in `failed`, and the next block runs.
 */
export async function backfillFigureNeeds(input: {
  learn: LearnSupabaseClient;
  plan: PublicDb;
  client: Pick<Anthropic, 'messages'>;
  context: FigureResolveContext;
  onSpend?: (userId: string, report: SpendReport) => void;
  now?: Date;
}): Promise<BackfillResult> {
  const { learn, plan, client } = input;
  const now = input.now ?? new Date();
  const result: BackfillResult = { considered: 0, served: [], kept: [], failed: [] };

  const steps = await learn.from('figure_need_steps').select('user_id, key, plan_item_id');
  if (steps.error) throw new Error(`Reading the figure steps failed: ${steps.error.message}`);
  const stepRows = (steps.data ?? []) as { user_id: string; key: string; plan_item_id: string }[];
  if (stepRows.length === 0) return result;

  const done = await plan
    .from('plan_items')
    .select('id')
    .in('id', stepRows.map((s) => s.plan_item_id))
    .eq('status', 'done');
  if (done.error) throw new Error(`Reading the figure steps’ status failed: ${done.error.message}`);
  const doneIds = new Set(((done.data ?? []) as { id: string }[]).map((r) => r.id));
  const doneSteps = stepRows.filter((s) => doneIds.has(s.plan_item_id));
  if (doneSteps.length === 0) return result;
  const doneKey = new Set(doneSteps.map((s) => `${s.user_id}:${s.key}`));

  const needs = await learn
    .from('figure_needs')
    .select('id, user_id, card_id, ordinal, need, shows, why, caption, key, tried_at')
    .is('served_at', null)
    .in('key', [...new Set(doneSteps.map((s) => s.key))]);
  if (needs.error) throw new Error(`Reading the figure needs failed: ${needs.error.message}`);
  const waiting = ((needs.data ?? []) as NeedRow[]).filter((row) => doneKey.has(`${row.user_id}:${row.key}`));
  const due = dueNeeds(waiting, now);
  result.considered = due.length;

  for (const need of due) {
    try {
      const { data, error } = await learn
        .from('feed_cards')
        .select('id, idea_name, hook, summary, takeaway, example, figures')
        .eq('user_id', need.user_id)
        .eq('id', need.card_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const card = data as CardRow | null;
      if (!card) continue;

      const stored = Array.isArray(card.figures) ? [...(card.figures as unknown[])] : [];
      const here = readStoredFigures(stored)[need.ordinal] ?? null;
      const markServed = async (kind: string) => {
        const marked = await learn
          .from('figure_needs')
          .update({ served_kind: kind, served_at: now.toISOString(), unserved_reason: null, tried_at: now.toISOString() })
          .eq('user_id', need.user_id)
          .eq('id', need.id);
        if (marked.error) throw new Error(marked.error.message);
        result.served.push({ needId: need.id, cardId: card.id, kind });
      };
      // Replaced by hand, or by an earlier run that stopped before marking it.
      if (here && here.kind !== 'wanted') {
        await markServed(here.kind);
        continue;
      }

      const written = await writeBackfillBlock({
        client,
        lesson: { name: card.idea_name ?? 'A lesson', hook: card.hook, summary: card.summary, takeaway: card.takeaway, example: card.example },
        wanted: { need: need.need, shows: need.shows, why: need.why, caption: here?.caption ?? need.caption },
        onSpend: (report) => input.onSpend?.(need.user_id, report),
      });
      if (written.failed !== undefined) {
        result.failed.push({ needId: need.id, detail: written.failed });
        continue;
      }

      let reason: string | null = written.ok ? null : (written.reason ?? 'The writer could not make the figure.');
      if (written.ok) {
        // A chart or a map is fetched now and kept, so the page reads it from the cache; none found is a block the page could only caption.
        const [resolved] = await resolveFigures([written.block], input.context);
        if (resolved && resolved.resolved === null) reason = 'No registered source holds the data this figure needs.';
      }
      if (!written.ok || reason) {
        const kept = await learn
          .from('figure_needs')
          .update({ unserved_reason: reason, tried_at: now.toISOString() })
          .eq('user_id', need.user_id)
          .eq('id', need.id);
        if (kept.error) throw new Error(kept.error.message);
        result.kept.push({ needId: need.id, reason: reason ?? '' });
        continue;
      }

      stored[need.ordinal] = { kind: written.block.kind, caption: written.block.caption, spec: written.block.spec };
      const saved = await learn.from('feed_cards').update({ figures: stored }).eq('user_id', need.user_id).eq('id', card.id);
      if (saved.error) throw new Error(`Saving the figure failed: ${saved.error.message}`);
      await markServed(written.block.kind);
    } catch (err) {
      result.failed.push({ needId: need.id, detail: err instanceof Error ? err.message : 'failed' });
    }
  }
  return result;
}
