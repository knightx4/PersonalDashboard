import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { usageFrom, type SpendReport, type SpendSink } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { YOU_SCHEMA, type YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The person's own words, pulled out of their private notes (plan #2413.8):
 * concepts they name, claims they make about themselves, wants they state,
 * and dated lines about mood or energy, each with its quote. Stored in
 * you.note_extracts (you 0013) for the insight run to read instead of the
 * whole vault.
 *
 * One Haiku call per private note version, from the map sweep's tick straight
 * after the voice tagging, so a note is read once its voice is settled. Only
 * notes tagged private are sent (you.note_extracts_due): secret, clipped,
 * audience and reference notes never are. A note's lines are replaced
 * together when its blob changes, and a read that found nothing is recorded
 * too, so the note is not sent again until it changes.
 *
 * A quote the note does not contain is dropped, so a paraphrase never stands
 * as their words.
 */

export const EXTRACT_KINDS = ['concept', 'claim', 'want', 'mood'] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];

export const EXTRACT_MODEL = MODELS.youNoteExtracts;
export const EXTRACT_OPERATION: LearnOperation = 'extract-note-lines';
const TOOL_NAME = 'keep_lines';
/** The most lines kept from one note. */
export const MAX_LINES = 40;

const SYSTEM = `You read one private note from a person's own notebook and
copy out the lines that say who they are, so that a later reader can learn
about them from their own words without reading the whole notebook.

Keep four kinds of line:

concept: a name they coined or use for an idea of their own, a mode, a rule
they live by or a way of working, such as "Socrates Mode" or "rest in
reason". gist is the name as they write it. Not a term from a course or a
book they are only taking notes on.

claim: something they say about themselves: what they are like, what they do,
what they believe, what they are good or bad at. gist is the claim in a few
words.

want: something they say they want, hope for, mean to do or wish were
different. gist is the want in a few words.

mood: a line about their mood or energy on a day: tired, anxious, happy,
flat, wired. Only from a dated entry, and entry_date is required.

quote is their exact words copied from the note, one to three sentences, with
nothing added or reworded. entry_date is the date of the dated entry or
heading the quote sits under, or of the note when its title is a date, as
YYYY-MM-DD; leave it out when the note gives no date.

Most notes hold none of these: class notes, plans and lists usually say
nothing about the person. Return an empty list for those. Keep at most
${MAX_LINES} lines, the ones that say most.`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const lineSchema = z.object({
  kind: z.enum(EXTRACT_KINDS),
  gist: z.string().trim().max(200).optional().nullable(),
  quote: z.string().trim().min(1).max(1000),
  entry_date: z.string().trim().optional().nullable(),
});

const answerSchema = z.object({ lines: z.array(z.unknown()).max(200) });

export type ExtractLine = {
  kind: ExtractKind;
  gist: string | null;
  quote: string;
  entryDate: string | null;
};

export type ExtractNote = {
  id: string;
  userId: string;
  path: string;
  title: string;
  /** Up to 80,000 characters, as you.note_extracts_due returns them. */
  body: string;
  blobSha: string;
};

export function extractPrompt(note: Pick<ExtractNote, 'path' | 'title' | 'body'>): string {
  return [`Path: ${note.path}`, `Title: ${note.title}`, '', note.body].join('\n');
}

/** Lowercased, with markdown marks and runs of space folded, for finding a quote. */
function folded(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`>#[\]]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A real calendar date between 1990 and tomorrow, or null. */
export function entryDate(value: string | null | undefined, now: number): string | null {
  if (!value || !DATE.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== value) return null;
  if (value < '1990-01-01' || at > now + 86_400_000) return null;
  return value;
}

/**
 * The lines worth keeping from the model's answer: each a known kind, its
 * quote found in the note, a mood line only with a date, no quote twice, and
 * no more than MAX_LINES.
 */
export function keepLines(raw: unknown[], body: string, now: number): ExtractLine[] {
  const haystack = folded(body);
  const seen = new Set<string>();
  const kept: ExtractLine[] = [];
  for (const item of raw) {
    const parsed = lineSchema.safeParse(item);
    if (!parsed.success) continue;
    const { kind, gist, quote } = parsed.data;
    const needle = folded(quote);
    if (needle.length < 3 || !haystack.includes(needle)) continue;
    const date = entryDate(parsed.data.entry_date, now);
    if (kind === 'mood' && !date) continue;
    const key = `${kind}:${needle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ kind, gist: gist ? gist : null, quote, entryDate: date });
    if (kept.length >= MAX_LINES) break;
  }
  return kept;
}

/** One note's lines from Haiku, or null when the answer could not be read. */
export type ExtractModel = (note: ExtractNote, onSpend: SpendSink) => Promise<ExtractLine[] | null>;

export function haikuForExtracts(client: Pick<Anthropic, 'messages'>, now: () => number = Date.now): ExtractModel {
  return async (note, onSpend) => {
    const response = await client.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 6000,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Keep the lines from the note that say who the person is. An empty list when there are none.',
          input_schema: {
            type: 'object',
            properties: {
              lines: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', enum: [...EXTRACT_KINDS] },
                    gist: { type: 'string' },
                    quote: { type: 'string' },
                    entry_date: { type: 'string', description: 'YYYY-MM-DD' },
                  },
                  required: ['kind', 'quote'],
                },
              },
            },
            required: ['lines'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, EXTRACT_MODEL),
      messages: [{ role: 'user', content: extractPrompt(note) }],
    });
    onSpend({ model: EXTRACT_MODEL, usage: usageFrom(response.usage) });
    if (response.stop_reason === 'max_tokens') return null;
    const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
    const parsed = block && block.type === 'tool_use' ? answerSchema.safeParse(block.input) : null;
    return parsed?.success ? keepLines(parsed.data.lines, note.body, now()) : null;
  };
}

export type ExtractPorts = {
  /** Drop the lines of notes deleted or no longer private; returns how many notes. */
  prune(): Promise<number>;
  /** Private notes not yet read at their blob, in id order after `afterId`. */
  loadDue(afterId: string | null, limit: number): Promise<ExtractNote[]>;
  /** Replace one note's lines, only if it is still the blob that was read. */
  save(note: ExtractNote, lines: ExtractLine[]): Promise<void>;
  model?: ExtractModel;
  ledger?(userId: string, report: SpendReport): Promise<void>;
  now?(): number;
};

export type ExtractSummary = {
  pruned: number;
  read: number;
  lines: number;
  failed: number;
  /** Why the pass stopped early, or null when nothing was left. */
  stopped: 'time' | 'no-key' | 'failures' | null;
};

const PAGE = 24;
const CONCURRENCY = 6;
/** After this many failed calls in one pass, the rest wait for the next tick. */
const FAILURES_BEFORE_STOPPING = 5;

export async function extractNoteLines(opts: { ports: ExtractPorts; deadline: number }): Promise<ExtractSummary> {
  const { ports, deadline } = opts;
  const clock = ports.now ?? (() => Date.now());
  const summary: ExtractSummary = { pruned: await ports.prune(), read: 0, lines: 0, failed: 0, stopped: null };

  const model = ports.model;
  let after: string | null = null;
  for (;;) {
    if (clock() >= deadline) {
      summary.stopped = 'time';
      return summary;
    }
    const due = await ports.loadDue(after, PAGE);
    if (due.length === 0) return summary;
    if (!model) {
      summary.stopped = 'no-key';
      return summary;
    }
    after = due[due.length - 1].id;

    for (let i = 0; i < due.length; i += CONCURRENCY) {
      if (clock() >= deadline) {
        summary.stopped = 'time';
        return summary;
      }
      await Promise.all(
        due.slice(i, i + CONCURRENCY).map(async (note) => {
          try {
            const lines = await model(note, (report) => {
              void ports.ledger?.(note.userId, report);
            });
            if (!lines) {
              summary.failed += 1;
              return;
            }
            await ports.save(note, lines);
            summary.read += 1;
            summary.lines += lines.length;
          } catch (err) {
            summary.failed += 1;
            console.error('[note extracts]', note.id, err instanceof Error ? err.message : err);
          }
        }),
      );
      if (summary.failed >= FAILURES_BEFORE_STOPPING) {
        summary.stopped = 'failures';
        return summary;
      }
    }
  }
}

/**
 * The ports over the service client. `userId` null works every account, which
 * only the map sweep's tick does.
 */
export function noteExtractPorts(opts: {
  supabase: VaultSupabaseClient;
  core: Pick<CoreSupabaseClient, 'from'> | null;
  userId: string | null;
  anthropicApiKey?: string | null;
  client?: Pick<Anthropic, 'messages'>;
}): ExtractPorts {
  const { core, userId } = opts;
  const you = opts.supabase.schema(YOU_SCHEMA) as unknown as YouSupabaseClient;
  const client =
    opts.client ?? (opts.anthropicApiKey ? new Anthropic({ apiKey: opts.anthropicApiKey }) : null);

  return {
    async prune() {
      const { data, error } = await you.rpc('prune_note_extracts', { p_user_id: userId });
      if (error) throw new Error(`Pruning note extracts failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },

    async loadDue(afterId, limit) {
      const { data, error } = await you.rpc('note_extracts_due', {
        p_user_id: userId,
        p_after_id: afterId,
        p_limit: limit,
      });
      if (error) throw new Error(`Reading private notes to extract failed: ${error.message}`);
      return (
        (data ?? []) as Array<{
          id: string;
          user_id: string;
          path: string;
          title: string | null;
          body: string | null;
          blob_sha: string;
        }>
      ).map((row) => ({
        id: row.id,
        userId: row.user_id,
        path: row.path,
        title: row.title ?? row.path,
        body: row.body ?? '',
        blobSha: row.blob_sha,
      }));
    },

    async save(note, lines) {
      const { error } = await you.rpc('save_note_extracts', {
        p_user_id: note.userId,
        p_note_id: note.id,
        p_blob_sha: note.blobSha,
        p_lines: lines.map((line) => ({
          kind: line.kind,
          gist: line.gist,
          quote: line.quote,
          entry_date: line.entryDate,
        })),
      });
      if (error) throw new Error(`Saving a note's extracts failed: ${error.message}`);
    },

    ...(client ? { model: haikuForExtracts(client) } : {}),

    ...(core
      ? {
          async ledger(owner: string, report: SpendReport) {
            await recordSpend(core, owner, {
              module: 'learn',
              operation: EXTRACT_OPERATION,
              model: report.model,
              usage: report.usage,
            });
          },
        }
      : {}),
  };
}
