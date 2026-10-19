import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { costMicrosFor, usageFrom, type TokenUsage } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import type { YouOperation } from '@/lib/core/spend/operations';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { YOU_SCHEMA, type YouSupabaseClient } from '@/lib/you/db/schema-name';
import { TRIPWIRE_KINDS, type TripwireKind } from '@/lib/you/insight-signals';
import {
  INSIGHT_CONFIDENCES,
  INSIGHT_KINDS,
  INSIGHT_STATUSES,
  listInsights,
  safeLink,
  type Insight,
} from '@/lib/you/insights';
import { INSIGHT_RUN_STALE_AFTER_MS, STALE_RUN_ERROR } from '@/lib/you/insights-run';

/**
 * A set of insights in one model call (plan #2413.9).
 *
 * The routine session that read the whole vault for every set cost a long
 * session on the person's plan. This reads what the cheap passes already
 * prepared and sends it to Opus once: the digest the last call wrote
 * (you.insight_digest), the lines from their private notes
 * (you.note_extracts, #2413.8), the nightly signals now and at the last run
 * (you.insight_signals, #2413.7), every earlier insight with its verdict, the
 * tripwires that fired, and a few private notes in full: About me, Notes to
 * Self, the newest journal entries and daily notes, and any note a fired
 * tripwire named. Only notes tagged private and holding no credentials are
 * read (you.insight_notes and you.insight_journal, you 0014).
 *
 * The call is streamed, thinks adaptively at high effort, caches the system
 * prompt and the notes, and answers in a JSON schema: three to five cards in
 * the shape you.insights holds, a tripwire for each, a two-sentence summary
 * and a new digest. Everything is saved in one transaction
 * (you.save_insight_run). The call is logged to core.model_spend, and one
 * whose estimate is over two dollars is refused before it is sent.
 *
 * The routine path (lib/you/insights-start.ts) stays for a full re-read the
 * person asks for.
 */

export const WRITE_MODEL = MODELS.youInsightsWrite;
export const WRITE_OPERATION: YouOperation = 'write-insights';

/** Output room: the thinking and the answer together. */
export const MAX_OUTPUT_TOKENS = 48_000;
/** The most a run may be estimated to cost before it is refused, in micro-dollars. */
export const MAX_ESTIMATE_MICROS = 2_000_000;
/** Characters per token for the estimate; low, so the estimate errs high. */
const CHARS_PER_TOKEN = 3;
/** The most cards one run keeps. */
export const MAX_INSIGHTS = 5;

/** The notes read whole on every run, when they exist and are private. */
export const KEY_NOTE_PATHS = ['Me/About me.md', 'Me/Notes to Self.md'] as const;
/** Notes named by fired tripwires, read whole as well, at most this many. */
const MAX_TRIPWIRE_NOTES = 4;
const JOURNAL_ENTRIES = 10;
const MAX_EXTRACTS = 600;
/** The extracts are cut at this many characters in the prompt. */
const EXTRACT_CHARS = 120_000;

// ---------------------------------------------------------------------------
// The material.
// ---------------------------------------------------------------------------

export type MaterialNote = { path: string; title: string; body: string; firstWrittenAt: string | null };
export type MaterialEntry = { path: string; date: string; entry: string };
export type MaterialExtract = {
  kind: string;
  gist: string | null;
  quote: string;
  entryDate: string | null;
  path: string | null;
};
export type MaterialSignals = { day: string; signals: Record<string, unknown> };
export type MaterialTripwire = {
  insightId: string;
  kind: string;
  params: Record<string, unknown>;
  lastFiredAt: string;
  evidence: unknown;
};

export type InsightMaterial = {
  digest: string | null;
  lastRunAt: string | null;
  insights: Insight[];
  signalsNow: MaterialSignals | null;
  signalsAtLastRun: MaterialSignals | null;
  fired: MaterialTripwire[];
  notes: MaterialNote[];
  journal: MaterialEntry[];
  extracts: MaterialExtract[];
};

/** Where a vault note opens in the app. */
export function noteLink(path: string): string {
  return `/vault/n/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The note paths a fired want_recurring tripwire found its mentions in. */
export function tripwireNotePaths(fired: readonly MaterialTripwire[]): string[] {
  const paths: string[] = [];
  for (const wire of fired) {
    const evidence = wire.evidence as { mentions?: unknown } | null;
    const mentions = Array.isArray(evidence?.mentions) ? evidence.mentions : [];
    for (const mention of mentions) {
      const row = mention as { source?: unknown; row_id?: unknown };
      if (row?.source === 'obsidian.notes' && typeof row.row_id === 'string' && !paths.includes(row.row_id)) {
        paths.push(row.row_id);
      }
    }
  }
  return paths.slice(0, MAX_TRIPWIRE_NOTES);
}

// ---------------------------------------------------------------------------
// The prompt.
// ---------------------------------------------------------------------------

const KIND_LINES = INSIGHT_KINDS.map((k) => `- ${k.kind}: ${k.label.toLowerCase()}`).join('\n');

export const SYSTEM = `You write insights about one person for the Insights tab of their own
app, where the assistant is called Dash. Each insight tells them something
about themselves that none of their notes says on its own. You are given
what earlier passes prepared: lines copied from their private notes, a few
private notes and journal entries in full, numbers counted from what they
did, every insight written before with their mark on it, and the digest you
wrote about them last time.

How to find candidates. Look where the strongest insights have come from,
and name ten or more candidates before choosing:
${KIND_LINES}
A concept they named themselves (a mode, a rule, a word they coined). A
claim they make about themselves that the numbers can test. A phrase that
comes back across years. Two positions they hold that pull against each
other. A want that recurs with no action behind it. One structure across
unrelated interests. What reliably comes before a low.

Go down three layers, then one more than seems needed. Every card has:
- saw: the evidence, their quotes and the numbers side by side.
- deeper: the mechanism underneath. It adds a source or an explanation the
  first layer lacked; a rephrasing is not a second layer.
- further: what the pattern protects them from or costs them, tied to
  something live now where one exists: a passed deadline, an open step, a
  saved lead, an application with no reply.
Before writing a card, ask what would make the deeper layer obvious to them,
and go past that.

Filter hard. Drop any card that restates one note, however well. Drop any
card without two sources or a span of time. Use only the numbers given here,
as given; never invent a count. Label a card whose deeper layer is your
inference rather than something a source shows as a hunch; high is for a
card whose every layer has a receipt, medium for the rest. Leave out
relationships, health and family unless a verdict note asks for them.

The earlier insights and their marks:
- Marked right or wrong: never write it again, nor a card a reader would take
  for the same claim in other words.
- Marked not quite: you may rework it with their note in hand. The new card
  answers the note and names the old card's id in supersedes.
- Not marked: do not repeat it; it is still on their tab.
- Read the notes on not quite and wrong for what they object to, such as a
  claim that was too neat or a misread source, and avoid it in every card.
- If the material shows an earlier card misread the evidence, write the
  corrected card and supersede the old one.

Write three to five cards. If fewer than three survive, write those and say
why in the summary; never pad. Write to them as "you", in plain sentences,
in their own words where possible. No slogans, no "not X, it's Y", no dashes
for rhythm. Never write "Claude"; you are Dash.

Each card:
- kind: one of the words above.
- claim: one or two sentences.
- layers: saw, deeper and further, in that order.
- receipts: every source the card relies on, at least two. source is the
  table (job_search.applications, you.insight_signals) or the vault path
  (Me/Notes to Self.md); row_id the row's id, or null for a note or a
  signal; quote the words or the number relied on; link the app path given
  next to the source in the material, or null.
- confidence: high, medium or hunch.
- live_ref: the live thing the further layer points at, in one line, or null.
- supersedes: the id of the earlier card this one replaces, or null.
- tripwire: what should bring the card back if the pattern shows up again,
  or null when none of these fits:
  - building_while_waiting {days, window_days}: they build the app on
    \`days\` days within \`window_days\` after sending an application with no reply.
  - deadline_during_building {window_days}: a deadline passes on a day they
    were building.
  - rule_broken {rule}: they apply to a role that breaks a rule they wrote;
    rule is one of their rules, or null for any.
  - want_recurring {words, min_mentions, window_days}: the want, in two to
    five words they actually use, comes back \`min_mentions\` times in
    \`window_days\` days with nothing done about it.
  Leave a number null to take the default.

summary: two sentences on what you read and what you found, for the run.

digest: your account of the person for the next call, which will read it
instead of everything you read today. Up to about 1,500 words. Keep what the
next call needs: the concepts and phrases that recur, the claims worth
testing and how they tested this time, the open threads, the numbers that
moved and from what to what, what their marks have taught you about how
they want to be read, and the candidates you set aside and why. Write it
as notes to yourself, not to them.`;

/** The JSON schema the answer must follow. */
export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights', 'summary', 'digest'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'claim', 'layers', 'receipts', 'confidence', 'live_ref', 'supersedes', 'tripwire'],
        properties: {
          kind: { type: 'string', enum: INSIGHT_KINDS.map((k) => k.kind) },
          claim: { type: 'string' },
          layers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['depth', 'text'],
              properties: {
                depth: { type: 'string', enum: ['saw', 'deeper', 'further'] },
                text: { type: 'string' },
              },
            },
          },
          receipts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'row_id', 'quote', 'link'],
              properties: {
                source: { type: 'string' },
                row_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                quote: { type: 'string' },
                link: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
          confidence: { type: 'string', enum: [...INSIGHT_CONFIDENCES] },
          live_ref: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          supersedes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          tripwire: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['kind', 'days', 'window_days', 'rule', 'words', 'min_mentions'],
                properties: {
                  kind: { type: 'string', enum: [...TRIPWIRE_KINDS] },
                  days: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                  window_days: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                  rule: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  words: { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] },
                  min_mentions: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
    summary: { type: 'string' },
    digest: { type: 'string' },
  },
} as const;

const json = (value: unknown) => JSON.stringify(value);

/**
 * The part of the material that changes least between runs a few minutes
 * apart: the notes in full and the lines from the rest. It goes first, after
 * the system prompt, under the cache mark.
 */
export function renderNotes(material: InsightMaterial): string {
  const notes = material.notes.length
    ? material.notes
        .map(
          (n) =>
            `### ${n.path} (link ${noteLink(n.path)}${n.firstWrittenAt ? `, first written ${n.firstWrittenAt.slice(0, 10)}` : ''})\n${n.body}`,
        )
        .join('\n\n')
    : 'None of the key notes is there.';
  const journal = material.journal.length
    ? material.journal.map((e) => `### ${e.date}, ${e.path} (link ${noteLink(e.path)})\n${e.entry}`).join('\n\n')
    : 'No dated entries.';

  let extractChars = 0;
  const extractLines: string[] = [];
  for (const line of material.extracts) {
    const text = `- [${line.kind}${line.entryDate ? ` ${line.entryDate}` : ''}] ${line.gist ? `${line.gist}: ` : ''}"${line.quote}"${line.path ? ` (${line.path}, link ${noteLink(line.path)})` : ''}`;
    if (extractChars + text.length > EXTRACT_CHARS) break;
    extractChars += text.length + 1;
    extractLines.push(text);
  }
  const extracts = extractLines.length ? extractLines.join('\n') : 'No lines have been pulled from their notes yet.';

  return [
    '## Key private notes, in full',
    notes,
    '## The newest journal entries and daily notes',
    journal,
    '## Lines from their private notes',
    'Each line is their exact words, with the kind of line, its date where the note gave one, and the note.',
    extracts,
  ].join('\n\n');
}

/** The rest: what changes every run. */
export function renderState(material: InsightMaterial): string {
  const insights = material.insights.length
    ? material.insights
        .map((i) =>
          json({
            id: i.id,
            written: i.createdAt.slice(0, 10),
            status: i.status,
            kind: i.kind,
            claim: i.claim,
            layers: i.layers.map((l) => `${l.depth}: ${l.text}`),
            mark: i.verdict ? i.verdict.verdict : 'not marked',
            mark_note: i.verdict?.note ?? null,
          }),
        )
        .join('\n')
    : 'None yet. This is the first set.';
  const fired = material.fired.length
    ? material.fired
        .map((t) =>
          json({ insight_id: t.insightId, kind: t.kind, params: t.params, fired: t.lastFiredAt, evidence: t.evidence }),
        )
        .join('\n')
    : 'None has fired.';
  const signals = (s: MaterialSignals | null) => (s ? `${s.day}: ${json(s.signals)}` : 'none');

  return [
    '## Your digest from last time',
    material.digest ?? 'There is no digest yet: this is the first call.',
    `## The numbers (you.insight_signals, link /you/insights)`,
    `Now, ${signals(material.signalsNow)}`,
    `At the last run${material.lastRunAt ? ` (${material.lastRunAt.slice(0, 10)})` : ''}, ${signals(material.signalsAtLastRun)}`,
    '## Tripwires that fired since they were written',
    fired,
    '## Every insight written before, with their mark',
    insights,
    'Write the new set now, as the JSON the schema asks for.',
  ].join('\n\n');
}

export type InsightRequest = {
  model: string;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  thinking: { type: 'adaptive' };
  output_config: { effort: 'high'; format: { type: 'json_schema'; schema: typeof ANSWER_SCHEMA } };
};

export function insightRequest(material: InsightMaterial): InsightRequest {
  return {
    model: WRITE_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: renderNotes(material), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: renderState(material) },
        ],
      },
    ],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
  };
}

/**
 * What the call could cost at most, in micro-dollars: the prompt priced as
 * uncached input at three characters a token, and every output token used.
 */
export function estimateMicros(request: InsightRequest): number {
  const chars =
    request.system.reduce((sum, block) => sum + block.text.length, 0) +
    JSON.stringify(request.messages).length +
    JSON.stringify(ANSWER_SCHEMA).length;
  const usage: TokenUsage = {
    inputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: request.max_tokens,
  };
  return costMicrosFor(request.model, usage) ?? Number.POSITIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// Reading the answer.
// ---------------------------------------------------------------------------

export type NewInsight = {
  kind: string;
  claim: string;
  layers: { depth: 'saw' | 'deeper' | 'further'; text: string }[];
  receipts: { source: string; row_id: string | null; quote: string; link: string | null }[];
  confidence: (typeof INSIGHT_CONFIDENCES)[number];
  live_ref: string | null;
  supersedes: string | null;
  tripwire: { kind: TripwireKind; params: Record<string, unknown> } | null;
};

export type InsightAnswer = { insights: NewInsight[]; summary: string; digest: string; dropped: number };

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));
const count = (max: number) => z.number().int().min(1).max(max).nullable().optional();

const cardSchema = z.object({
  kind: z.enum(INSIGHT_KINDS.map((k) => k.kind) as [string, ...string[]]),
  claim: z.string().trim().min(1).max(1000),
  layers: z.array(z.object({ depth: z.enum(['saw', 'deeper', 'further']), text: z.string().trim().min(1).max(4000) })),
  receipts: z.array(
    z.object({ source: z.string().trim().min(1).max(300), row_id: nullableText, quote: z.string().trim().max(1000), link: nullableText }),
  ),
  confidence: z.enum(INSIGHT_CONFIDENCES),
  live_ref: nullableText,
  supersedes: nullableText,
  tripwire: z
    .object({
      kind: z.enum(TRIPWIRE_KINDS),
      days: count(30),
      window_days: count(90),
      rule: nullableText,
      words: z.array(z.string()).nullable().optional(),
      min_mentions: count(20),
    })
    .nullable()
    .optional(),
});

const answerSchema = z.object({
  insights: z.array(z.unknown()),
  summary: z.string().trim().min(1),
  digest: z.string().trim().min(1),
});

/** A claim folded for comparing: lowercased, letters and digits only. */
function folded(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The tripwire's params as the nightly check reads them, or null when it cannot be checked. */
export function tripwireOf(raw: z.infer<typeof cardSchema>['tripwire']): NewInsight['tripwire'] {
  if (!raw) return null;
  const params: Record<string, unknown> = {};
  if (raw.kind === 'building_while_waiting') {
    if (raw.days) params.days = raw.days;
    if (raw.window_days) params.window_days = raw.window_days;
  } else if (raw.kind === 'deadline_during_building') {
    if (raw.window_days) params.window_days = raw.window_days;
  } else if (raw.kind === 'rule_broken') {
    if (raw.rule) params.rule = raw.rule;
  } else {
    const words = (raw.words ?? []).map((w) => w.trim()).filter((w) => w.length >= 2 && w.length <= 60);
    if (words.length === 0) return null;
    params.words = [...new Set(words)].slice(0, 8);
    if (raw.min_mentions) params.min_mentions = Math.max(2, raw.min_mentions);
    if (raw.window_days) params.window_days = raw.window_days;
  }
  return { kind: raw.kind, params };
}

/**
 * The cards worth saving from the model's answer. A card is dropped when it
 * lacks one of the three layers or two receipts, or when its claim is one
 * already written. supersedes is kept only when it names an earlier card
 * that is not already superseded. At most five are kept.
 */
export function readAnswer(raw: unknown, earlier: readonly Insight[]): InsightAnswer | null {
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const known = new Set(earlier.filter((i) => i.status !== 'superseded').map((i) => i.id));
  const seen = new Set(earlier.map((i) => folded(i.claim)));
  const supersededNow = new Set<string>();
  const kept: NewInsight[] = [];
  let dropped = 0;

  for (const item of parsed.data.insights) {
    const card = cardSchema.safeParse(item);
    if (!card.success) {
      dropped += 1;
      continue;
    }
    const c = card.data;
    const byDepth = (depth: 'saw' | 'deeper' | 'further') => c.layers.find((l) => l.depth === depth);
    const layers = (['saw', 'deeper', 'further'] as const).flatMap((depth) => {
      const layer = byDepth(depth);
      return layer ? [{ depth, text: layer.text }] : [];
    });
    const receipts = c.receipts.map((r) => ({
      source: r.source,
      row_id: r.row_id,
      quote: r.quote,
      link: safeLink(r.link),
    }));
    const claim = folded(c.claim);
    if (layers.length < 3 || receipts.length < 2 || seen.has(claim) || kept.length >= MAX_INSIGHTS) {
      dropped += 1;
      continue;
    }
    seen.add(claim);
    const supersedes = c.supersedes && known.has(c.supersedes) && !supersededNow.has(c.supersedes) ? c.supersedes : null;
    if (supersedes) supersededNow.add(supersedes);
    kept.push({
      kind: c.kind,
      claim: c.claim,
      layers,
      receipts,
      confidence: c.confidence,
      live_ref: c.live_ref ? c.live_ref.slice(0, 300) : null,
      supersedes,
      tripwire: tripwireOf(c.tripwire),
    });
  }
  return {
    insights: kept,
    summary: parsed.data.summary.slice(0, 4000),
    digest: parsed.data.digest.slice(0, 20000),
    dropped,
  };
}

/** The answer's JSON, from the text blocks of a finished message. */
export function answerJson(message: Pick<Anthropic.Message, 'content'>): unknown {
  const text = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

export type WriteInsightsPorts = {
  /** Queue a run, or say why one cannot start. */
  queue(): Promise<{ runId: string } | { error: string; running?: boolean }>;
  markRunning(runId: string): Promise<void>;
  fail(runId: string, error: string): Promise<void>;
  gather(): Promise<InsightMaterial>;
  /** One streamed call; returns the finished message. */
  call(request: InsightRequest): Promise<Anthropic.Message>;
  ledger(usage: TokenUsage): Promise<void>;
  /** Save the cards, tripwires, replacements and digest, and mark the run ready. */
  save(runId: string, answer: InsightAnswer): Promise<string[]>;
  /** Say on Home what Dash did. */
  record(runId: string, written: number): Promise<void>;
};

export type WriteInsightsResult =
  | { ok: true; runId: string; insightIds: string[]; costMicros: number | null }
  | { ok: false; runId: string | null; error: string; running?: boolean };

/**
 * One run: queue it (or take the run already queued for it), gather the
 * material, refuse it if the estimate is over two dollars, make the call,
 * log what it cost, and save the answer. Any failure marks the run failed
 * with a sentence the person can act on.
 */
export async function writeInsights(opts: { ports: WriteInsightsPorts; runId?: string | null }): Promise<WriteInsightsResult> {
  const { ports } = opts;
  let runId = opts.runId ?? null;
  if (!runId) {
    const queued = await ports.queue();
    if ('error' in queued) return { ok: false, runId: null, error: queued.error, running: queued.running };
    runId = queued.runId;
  }

  const fail = async (error: string): Promise<WriteInsightsResult> => {
    await ports.fail(runId, error);
    return { ok: false, runId, error };
  };

  try {
    await ports.markRunning(runId);
    const material = await ports.gather();
    const request = insightRequest(material);
    const estimate = estimateMicros(request);
    if (estimate > MAX_ESTIMATE_MICROS) {
      return fail(
        `Dash stopped before writing: this set was estimated at $${(estimate / 1_000_000).toFixed(2)}, over the $2.00 limit.`,
      );
    }

    let message: Anthropic.Message;
    try {
      message = await ports.call(request);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return fail('Dash is rate-limited right now. Try again in a few minutes.');
      if (error instanceof Anthropic.APIError) return fail(`Dash could not write insights (${error.status}). Try again.`);
      return fail(`Dash could not write insights: ${error instanceof Error ? error.message : 'the call failed'}.`);
    }
    const usage = usageFrom(message.usage);
    await ports.ledger(usage);
    const costMicros = costMicrosFor(WRITE_MODEL, usage);

    const stop: string | null = message.stop_reason;
    if (stop === 'refusal') return fail('Dash declined to write this set. Try again later.');
    if (stop === 'max_tokens') return fail('Dash ran out of room before finishing the set. Try again.');
    const answer = readAnswer(answerJson(message), material.insights);
    if (!answer) return fail('Dash wrote an answer it could not read. Try again.');
    if (answer.insights.length === 0) {
      return fail('Every card Dash wrote repeated an earlier one or lacked its evidence, so none was kept. Try again.');
    }

    const insightIds = await ports.save(runId, answer);
    await ports.record(runId, insightIds.length);
    return { ok: true, runId, insightIds, costMicros };
  } catch (error) {
    console.error('[insights write]', runId, error instanceof Error ? error.message : error);
    return fail(`Dash could not finish the set: ${error instanceof Error ? error.message : 'something failed'}.`.slice(0, 2000));
  }
}

// ---------------------------------------------------------------------------
// The ports over the service client.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Reads and writes for one person through the service role, every query naming them. */
export function writeInsightsPorts(opts: {
  supabase: VaultSupabaseClient;
  core: Pick<CoreSupabaseClient, 'from' | 'rpc'>;
  userId: string;
  anthropicApiKey?: string | null;
  client?: Pick<Anthropic, 'messages'>;
  now?: () => number;
  /** How long the call may stream before it is given up. */
  timeoutMs?: number;
}): WriteInsightsPorts {
  const { supabase, core, userId } = opts;
  const you = supabase.schema(YOU_SCHEMA) as unknown as YouSupabaseClient;
  const now = opts.now ?? Date.now;
  const client = opts.client ?? (opts.anthropicApiKey ? new Anthropic({ apiKey: opts.anthropicApiKey }) : null);

  return {
    async queue() {
      // A run left queued or running past the stale mark has stopped.
      await you
        .from('insight_runs')
        .update({ status: 'failed', error: STALE_RUN_ERROR, finished_at: new Date(now()).toISOString() })
        .eq('user_id', userId)
        .in('status', ['queued', 'running'])
        .lt('requested_at', new Date(now() - INSIGHT_RUN_STALE_AFTER_MS).toISOString());
      const { data, error } = await you.from('insight_runs').insert({ user_id: userId, status: 'queued' }).select('id').single();
      if (error?.code === '23505') return { error: 'Dash is already looking again.', running: true };
      if (error || !data) return { error: error?.message ?? 'Could not start the run.' };
      return { runId: (data as Row).id as string };
    },

    async markRunning(runId) {
      const { error } = await you
        .from('insight_runs')
        .update({ status: 'running', started_at: new Date(now()).toISOString(), error: null })
        .eq('id', runId)
        .eq('user_id', userId);
      if (error) throw new Error(`Starting the run failed: ${error.message}`);
    },

    async fail(runId, message) {
      await you
        .from('insight_runs')
        .update({ status: 'failed', error: message.slice(0, 2000), finished_at: new Date(now()).toISOString() })
        .eq('id', runId)
        .eq('user_id', userId)
        .in('status', ['queued', 'running']);
    },

    async gather() {
      const [digest, insights, lastRun, signalsNow, tripwires, journal, extracts] = await Promise.all([
        you.from('insight_digest').select('body').eq('user_id', userId).maybeSingle(),
        listInsights(you, userId, { statuses: INSIGHT_STATUSES }),
        you
          .from('insight_runs')
          .select('finished_at')
          .eq('user_id', userId)
          .eq('status', 'ready')
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        you.from('insight_signals').select('day, signals').eq('user_id', userId).order('day', { ascending: false }).limit(1).maybeSingle(),
        you
          .from('insight_tripwires')
          .select('insight_id, kind, params, last_fired_at, fired_evidence')
          .eq('user_id', userId)
          .not('last_fired_at', 'is', null),
        you.rpc('insight_journal', { p_user_id: userId, p_limit: JOURNAL_ENTRIES }),
        you
          .from('note_extracts')
          .select('kind, gist, quote, entry_date, note_id')
          .eq('user_id', userId)
          .order('entry_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(MAX_EXTRACTS),
      ]);
      for (const result of [digest, lastRun, signalsNow, tripwires, journal, extracts]) {
        if (result.error) throw new Error(`Reading what the run needs failed: ${result.error.message}`);
      }

      const lastRunAt = str((lastRun.data as Row | null)?.finished_at);
      let signalsAtLastRun: MaterialSignals | null = null;
      if (lastRunAt) {
        const { data, error } = await you
          .from('insight_signals')
          .select('day, signals')
          .eq('user_id', userId)
          .lte('day', lastRunAt.slice(0, 10))
          .order('day', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`Reading the signals at the last run failed: ${error.message}`);
        if (data) signalsAtLastRun = { day: String((data as Row).day), signals: ((data as Row).signals ?? {}) as Record<string, unknown> };
      }

      const fired: MaterialTripwire[] = ((tripwires.data ?? []) as Row[]).map((t) => ({
        insightId: String(t.insight_id),
        kind: String(t.kind),
        params: (t.params ?? {}) as Record<string, unknown>,
        lastFiredAt: String(t.last_fired_at),
        evidence: t.fired_evidence ?? null,
      }));

      const paths = [...KEY_NOTE_PATHS, ...tripwireNotePaths(fired).filter((p) => !(KEY_NOTE_PATHS as readonly string[]).includes(p))];
      const notesResult = await you.rpc('insight_notes', { p_user_id: userId, p_paths: paths });
      if (notesResult.error) throw new Error(`Reading the key notes failed: ${notesResult.error.message}`);

      const extractRows = (extracts.data ?? []) as Row[];
      const noteIds = [...new Set(extractRows.map((r) => String(r.note_id)))];
      const pathById = new Map<string, string>();
      for (let i = 0; i < noteIds.length; i += 200) {
        const { data, error } = await supabase
          .from('notes')
          .select('id, path')
          .eq('user_id', userId)
          .in('id', noteIds.slice(i, i + 200));
        if (error) throw new Error(`Reading the notes the lines came from failed: ${error.message}`);
        for (const row of (data ?? []) as Row[]) pathById.set(String(row.id), String(row.path));
      }

      const signalsRow = signalsNow.data as Row | null;
      return {
        digest: str((digest.data as Row | null)?.body),
        lastRunAt,
        insights,
        signalsNow: signalsRow ? { day: String(signalsRow.day), signals: (signalsRow.signals ?? {}) as Record<string, unknown> } : null,
        signalsAtLastRun,
        fired,
        notes: ((notesResult.data ?? []) as Row[]).map((n) => ({
          path: String(n.path),
          title: str(n.title) ?? String(n.path),
          body: str(n.body) ?? '',
          firstWrittenAt: str(n.first_written_at),
        })),
        journal: ((journal.data ?? []) as Row[]).map((e) => ({
          path: String(e.path),
          date: String(e.entry_date),
          entry: str(e.entry) ?? '',
        })),
        extracts: extractRows.map((r) => ({
          kind: String(r.kind),
          gist: str(r.gist),
          quote: String(r.quote),
          entryDate: str(r.entry_date),
          path: pathById.get(String(r.note_id)) ?? null,
        })),
      };
    },

    async call(request) {
      if (!client) throw new Error('ANTHROPIC_API_KEY is not set on this deployment');
      // The installed SDK's types predate adaptive thinking and output_config;
      // the body goes to the API as written.
      return client.messages
        .stream(request as unknown as Anthropic.MessageStreamParams, {
          timeout: opts.timeoutMs ?? 15 * 60_000,
          maxRetries: 0,
        })
        .finalMessage();
    },

    async ledger(usage) {
      await recordSpend(core, userId, { module: 'you', operation: WRITE_OPERATION, model: WRITE_MODEL, usage });
    },

    async save(runId, answer) {
      const { data, error } = await you.rpc('save_insight_run', {
        p_user_id: userId,
        p_run_id: runId,
        p_insights: answer.insights,
        p_digest: answer.digest,
        p_summary: answer.summary,
      });
      if (error) throw new Error(`Saving the insights failed: ${error.message}`);
      return Array.isArray(data) ? (data as string[]) : [];
    },

    async record(runId, written) {
      const { error } = await core.rpc('record_dash_action', {
        p_user_id: userId,
        p_subject_ref: `you.insight_runs:${runId}`,
        p_op: 'update',
        p_kind: 'insights_run',
        p_summary: `Dash wrote ${written} ${written === 1 ? 'insight' : 'insights'} about you.`,
        p_surface: 'scheduled',
      });
      if (error) console.error('[insights write] record', error.message);
    },
  };
}
