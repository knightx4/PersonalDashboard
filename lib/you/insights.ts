import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * Deep insights about the person (you.insights, you.insight_verdicts and
 * you.insight_runs, migrations-you/0010, plan #2413.1). A run writes the rows
 * through scripts/sql.ts; this reads them back for the Insights tab and for
 * the next run, defensively, since jsonb written by a session is only as
 * well-formed as that session was careful. An insight with no claim is left
 * out; a layer or receipt of the wrong shape is dropped and the rest kept.
 *
 * Every call names the person as well as relying on row level security, so
 * the same functions serve a service-role client.
 */

export const INSIGHT_DEPTHS = ['saw', 'deeper', 'further'] as const;
export type InsightDepth = (typeof INSIGHT_DEPTHS)[number];

export const INSIGHT_CONFIDENCES = ['high', 'medium', 'hunch'] as const;
export type InsightConfidence = (typeof INSIGHT_CONFIDENCES)[number];

export const INSIGHT_STATUSES = ['shown', 'retired', 'superseded'] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

export const VERDICTS = ['right', 'not_quite', 'wrong'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const RUN_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type InsightRunStatus = (typeof RUN_STATUSES)[number];

export type InsightLayer = { depth: InsightDepth; text: string };

/** One piece of evidence: the table or vault path, the row, the words or number relied on, and a link. */
export type InsightReceipt = {
  source: string;
  rowId: string | null;
  quote: string | null;
  link: string | null;
};

export type InsightVerdict = { verdict: Verdict; note: string | null; decidedAt: string };

export type Insight = {
  id: string;
  runId: string | null;
  kind: string;
  claim: string;
  layers: InsightLayer[];
  receipts: InsightReceipt[];
  confidence: InsightConfidence;
  liveRef: string | null;
  status: InsightStatus;
  supersededBy: string | null;
  createdAt: string;
  verdict: InsightVerdict | null;
};

export type InsightRun = {
  id: string;
  status: InsightRunStatus;
  summary: string | null;
  error: string | null;
  runUrl: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export const INSIGHT_COLUMNS =
  'id, run_id, kind, claim, layers, receipts, confidence, live_ref, status, superseded_by, created_at, ' +
  'insight_verdicts(verdict, note, decided_at)';

export const RUN_COLUMNS =
  'id, status, summary, error, run_url, requested_at, started_at, finished_at';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const oneOf = <T extends string>(words: readonly T[], value: unknown): T | null =>
  words.find((word) => word === value) ?? null;

/**
 * A link an href may hold: a path inside the app, or an http or https page.
 * Anything else, a javascript: link above all, is dropped.
 */
export function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const link = value.trim();
  if (link.startsWith('/') && !link.startsWith('//') && !link.startsWith('/\\')) return link;
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The layers in depth order, saw first; one of an unknown depth or with no text is dropped. */
export function layersOf(value: unknown): InsightLayer[] {
  if (!Array.isArray(value)) return [];
  const layers = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const depth = oneOf(INSIGHT_DEPTHS, row.depth);
    const body = text(row.text).trim();
    return depth && body ? [{ depth, text: body }] : [];
  });
  // A stable sort, so two layers at one depth keep the order they were written in.
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort(
      (a, b) =>
        INSIGHT_DEPTHS.indexOf(a.layer.depth) - INSIGHT_DEPTHS.indexOf(b.layer.depth) ||
        a.index - b.index,
    )
    .map(({ layer }) => layer);
}

/** The receipts that name a source; a quote given as a number is kept as its digits. */
export function receiptsOf(value: unknown): InsightReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const source = text(row.source).trim();
    if (!source) return [];
    const rawId = row.row_id;
    const rowId = typeof rawId === 'number' ? String(rawId) : textOrNull(rawId);
    const rawQuote = row.quote ?? row.number;
    const quote =
      typeof rawQuote === 'number' && Number.isFinite(rawQuote)
        ? String(rawQuote)
        : textOrNull(rawQuote);
    return [{ source, rowId, quote, link: safeLink(row.link) }];
  });
}

/** The verdict as PostgREST embeds it: an object, a list of one, or nothing. */
export function verdictOf(value: unknown): InsightVerdict | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') return null;
  const entry = row as Record<string, unknown>;
  const verdict = oneOf(VERDICTS, entry.verdict);
  if (!verdict) return null;
  return { verdict, note: textOrNull(entry.note), decidedAt: text(entry.decided_at) };
}

/** An insights row as the tab reads it, or null for one with no id or no claim. */
export function insightFromRow(row: Record<string, unknown>): Insight | null {
  const id = text(row.id);
  const claim = text(row.claim).trim();
  if (!id || !claim) return null;
  return {
    id,
    runId: textOrNull(row.run_id),
    kind: text(row.kind).trim() || 'insight',
    claim,
    layers: layersOf(row.layers),
    receipts: receiptsOf(row.receipts),
    confidence: oneOf(INSIGHT_CONFIDENCES, row.confidence) ?? 'hunch',
    liveRef: textOrNull(row.live_ref),
    status: oneOf(INSIGHT_STATUSES, row.status) ?? 'retired',
    supersededBy: textOrNull(row.superseded_by),
    createdAt: text(row.created_at),
    verdict: verdictOf(row.insight_verdicts),
  };
}

/** An insight_runs row; an unknown status reads as failed. */
export function runFromRow(row: Record<string, unknown>): InsightRun {
  return {
    id: text(row.id),
    status: oneOf(RUN_STATUSES, row.status) ?? 'failed',
    summary: textOrNull(row.summary),
    error: textOrNull(row.error),
    runUrl: safeLink(row.run_url),
    requestedAt: text(row.requested_at),
    startedAt: textOrNull(row.started_at),
    finishedAt: textOrNull(row.finished_at),
  };
}

/**
 * Their insights, newest first, each with its verdict. By default only the
 * shown ones; pass every status for what a run reads so it never repeats one
 * they have marked.
 */
export async function listInsights(
  client: YouSupabaseClient,
  userId: string,
  options: { statuses?: readonly InsightStatus[] } = {},
): Promise<Insight[]> {
  const statuses = options.statuses ?? ['shown'];
  const { data, error } = await client
    .from('insights')
    .select(INSIGHT_COLUMNS)
    .eq('user_id', userId)
    .in('status', [...statuses])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Reading your insights failed: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).flatMap((row) => {
    const insight = insightFromRow(row);
    return insight ? [insight] : [];
  });
}

/** Their newest run, or null before the first. */
export async function latestInsightRun(
  client: YouSupabaseClient,
  userId: string,
): Promise<InsightRun | null> {
  const { data, error } = await client
    .from('insight_runs')
    .select(RUN_COLUMNS)
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading your insight runs failed: ${error.message}`);
  return data ? runFromRow(data as Record<string, unknown>) : null;
}

/**
 * Marks one insight right, not quite or wrong, replacing any earlier mark.
 * A blank note is kept as none. Returns the verdict as saved.
 */
export async function saveVerdict(
  client: YouSupabaseClient,
  userId: string,
  insightId: string,
  verdict: Verdict,
  note?: string | null,
): Promise<InsightVerdict> {
  if (!oneOf(VERDICTS, verdict)) throw new Error(`Unknown verdict: ${String(verdict)}`);
  const cleaned = textOrNull(note);
  if (cleaned && cleaned.length > 2000)
    throw new Error('A note on an insight holds at most 2,000 characters.');
  const { data, error } = await client
    .from('insight_verdicts')
    .upsert(
      {
        user_id: userId,
        insight_id: insightId,
        verdict,
        note: cleaned,
        decided_at: new Date().toISOString(),
      },
      { onConflict: 'insight_id' },
    )
    .select('verdict, note, decided_at')
    .single();
  const saved = verdictOf(data);
  if (error || !saved) throw new Error(`Saving your mark failed: ${error?.message ?? 'no row'}`);
  return saved;
}

// ---------------------------------------------------------------------------
// The run's brief and the method's words (plan #2413.4).
// ---------------------------------------------------------------------------

/** The skill a run follows: the reading, the layers and the filter. */
export const INSIGHTS_SKILL_PATH = '.claude/skills/insights/SKILL.md';

/**
 * The words a run writes into you.insights.kind, one per place the strongest
 * insights came from (the skill's step 4). A card that fits none is a
 * pattern.
 */
export const INSIGHT_KINDS = [
  { kind: 'named_concept', label: 'A concept you named' },
  { kind: 'testable_claim', label: 'A claim the records test' },
  { kind: 'recurring_phrase', label: 'A phrase that comes back' },
  { kind: 'tension', label: 'Two positions that pull apart' },
  { kind: 'unmet_want', label: 'A want that recurs' },
  { kind: 'shared_structure', label: 'One structure, many interests' },
  { kind: 'precursor', label: 'What comes before' },
  { kind: 'pattern', label: 'A pattern' },
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number]['kind'];

/** Why a run was started: the weekly tick, the Look again button, or a big change. */
export type InsightRunReason = 'weekly' | 'look_again' | 'change';

/**
 * The brief the goals routine is fired with for an insights run. Its first
 * line hands the session to the insights skill (the goals skill, "Jobs that
 * follow another skill"); the skill reads the run row, the earlier insights
 * and the verdicts by the ids here, so nothing else has to fit in it. A run
 * started by a change names the change in one line.
 */
export function insightsBrief(input: {
  runId: string;
  userId: string;
  reason: InsightRunReason;
  change?: string | null;
}): string {
  const change = input.change?.replace(/\s+/g, ' ').trim();
  const why =
    input.reason === 'change'
      ? `started by a change${change ? `: ${change.slice(0, 300)}` : ''}`
      : input.reason === 'look_again'
        ? 'started by Look again'
        : 'weekly run';
  return [
    `Follow ${INSIGHTS_SKILL_PATH}`,
    `Insight run ${input.runId}`,
    `user_id ${input.userId}`,
    why,
  ].join('\n');
}
