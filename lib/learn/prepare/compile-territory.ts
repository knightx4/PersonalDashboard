import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { GOAL_KIND_LABELS, isGoalKind } from '@/lib/learn/goal-kind';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MAX_ITEMS_PER_SOURCE, MAX_PERFORMANCES, MAX_SOURCES } from '@/lib/learn/levels/draft-sources';
import { documentLabel, independenceKey, unitLine } from '@/lib/learn/levels/stored-sources';
import {
  canonicalityFrom,
  unsourcedFrom,
  type Territory,
  type TerritoryText,
  type TerritoryTopic,
} from '@/lib/learn/levels/territory';
import type { StepHandler } from './run';
import type { MatchedWeek, PulledDocument } from './structure-steps';

/**
 * The compile_territory step (plan #2276.4): Dash lays out the subject's
 * whole territory from the documents its preparation stored.
 *
 * One Sonnet call reads the subject's name and note, up to eight stored
 * documents as numbered lines (each unit's label, heading and topics, in the
 * order taught; never a unit's text or readings), and the Level 4 frame
 * titles nearest the subject. It answers with what someone who knows the
 * subject can do and thirty to fifty topics, each with the frame topic it
 * refines, a target level and the lines it came from, cited by number. The
 * numbers are turned into the territory's `from` lines here, so a topic can
 * only cite a line that exists, and unsourcedFrom is checked before the
 * territory is kept.
 *
 * A topic's canonicality is set by the count of independent documents its
 * lines come from (docs/LEARN-LEVELS-SPEC.md): two or more is canonical, one
 * is practitioner, none is personal. A subject with no stored documents is
 * compiled from the frame topics and the model's own reading, and every topic
 * is then personal.
 *
 * The result is a Territory (lib/learn/levels/territory.ts), the shape the
 * drafter in territory-run.ts already takes, stored on the preparation row.
 */

export const TERRITORY_COMPILE_MODEL = MODELS.learnTerritoryCompile;

/** Documents read at most: the drafting call takes eight sources. */
export const MAX_COMPILE_DOCUMENTS = MAX_SOURCES;
export const MIN_TOPICS = 30;
export const MAX_TOPICS = 50;
/** Frame titles offered to the call. */
export const FRAMES_OFFERED = 40;
/** Time the call is given; a step with less left pauses and starts it in the next call. */
export const COMPILE_CALL_MS = 170_000;
/** Attempts at reaching MIN_TOPICS before a short territory is kept. */
const ATTEMPTS = 2;

const TOOL_NAME = 'report_territory';

export type CompileUnit = { ordinal: number; label: string | null; heading: string; topics: string[] };

/** A stored document as the compiler reads it, with the weeks that matched the subject. */
export type CompileDocument = {
  itemId: string;
  title: string;
  url: string;
  institution: string | null;
  courseCode: string | null;
  term: string | null;
  units: CompileUnit[];
  /** Ordinals of the units match_weeks found for the subject. */
  matched: number[];
  /** The closest match's similarity, 0 for a document pulled but not matched. */
  best: number;
};

export type CompileSubject = { id: string; name: string; note: string | null; kind: string | null };

export type CompileInput = { subject: CompileSubject; documents: CompileDocument[]; frames: string[] };

export type CompileResult =
  | { ok: true; territory: Territory; dropped: { cites: number; topics: number } }
  | { ok: false; detail: string };

// Reading the documents -----------------------------------------------------

/**
 * The units a document gives: every one when they fit, otherwise the matched
 * ones first and the earliest of the rest, put back in the order taught.
 */
export function chosenUnits(units: readonly CompileUnit[], matched: readonly number[]): CompileUnit[] {
  const ordered = [...units].sort((a, b) => a.ordinal - b.ordinal);
  if (ordered.length <= MAX_ITEMS_PER_SOURCE) return ordered;
  const hit = new Set(matched);
  const kept = [...ordered.filter((u) => hit.has(u.ordinal)), ...ordered.filter((u) => !hit.has(u.ordinal))].slice(
    0,
    MAX_ITEMS_PER_SOURCE,
  );
  return kept.sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * The documents as the territory's texts, keyed d1 onwards: the documents
 * with the most matched weeks first, then the closest, at most eight. Lines
 * repeated within a document are kept once, so a cite names one line.
 */
export function territoryTexts(documents: readonly CompileDocument[]): TerritoryText[] {
  const ranked = [...documents]
    .filter((d) => d.units.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || b.best - a.best)
    .slice(0, MAX_COMPILE_DOCUMENTS);
  return ranked.map((doc, i) => ({
    key: `d${i + 1}`,
    label: documentLabel(doc),
    items: [...new Set(chosenUnits(doc.units, doc.matched).map(unitLine))],
    itemId: doc.itemId,
    url: doc.url,
    independence: independenceKey(doc),
  }));
}

// The call ---------------------------------------------------------------

const SYSTEM = `You lay out the territory of a subject one person wants to learn: the
whole high-level plan of what knowing it means, before any topic is written.

You are given the subject's name and the person's note on it, the syllabi and
other structure documents stored for it (each line one unit, in the order the
document teaches them), and a list of frame topics: broad encyclopaedia
articles the subject's topics sit under.

Report through ${TOOL_NAME}:

- performances: three to five things someone who knows this subject can do,
  each a concrete task ("Build an ARR bridge from a customer list and explain
  each movement"), not a feeling or a topic name.
- topics: thirty to fifty topics that together make up the subject, in the
  order a learner would meet them, foundations first. Each topic is one
  teachable unit: smaller than a field, larger than one fact or term.
  - ask: the topic's name as a short phrase, unique in the list.
  - scope: one sentence saying what the topic covers and where it stops.
  - frame: the ONE frame topic from the list it refines, copied exactly.
  - target: the level on a ten-level ladder this person should reach. 1 place
    it, 2 define it, 3 explain how it works, 4 do it on a clean given case,
    5 do it on a real case, 6 judge the output, 7 name its limits, 8 connect it
    to neighbouring topics, 9 practitioners' moves, 10 argue its live disputes.
    Core topics of the subject sit at 4 to 6, background at 2 or 3; go above 6
    only where the note asks for depth.
  - cites: the document lines the topic comes from, by number, such as "d2.7"
    for line 7 of document d2. Cite every line that teaches it, across
    documents where several cover it: a topic taught in two independent
    documents is canonical. Cite only lines that are there. A topic the
    documents do not cover, but the subject plainly needs, cites nothing.

Cover what the documents teach before adding what they leave out, and keep
the topics to what the person's note is after when it narrows the subject.`;

function documentsBlock(texts: readonly TerritoryText[]): string[] {
  if (texts.length === 0) {
    return [
      'No structure documents are stored for this subject. Lay out the territory',
      'from the frame topics and your own reading, and give every topic an empty',
      'cites list.',
    ];
  }
  return texts.flatMap((text) => [
    `Document ${text.key}: ${text.label}`,
    ...text.items.map((item, i) => `${text.key}.${i + 1} ${item}`),
    '',
  ]);
}

/** The user message for the call. Exported for the test. */
export function compilePrompt(input: CompileInput, texts: readonly TerritoryText[]): string {
  const { subject } = input;
  const kind = isGoalKind(subject.kind) ? GOAL_KIND_LABELS[subject.kind].label : null;
  return [
    `Subject: ${subject.name.trim()}`,
    subject.note?.trim() ? `The person's note: ${subject.note.trim()}` : 'The person left no note.',
    ...(kind ? [`Kind of subject: ${kind}`] : []),
    '',
    ...documentsBlock(texts),
    '',
    'Frame topics:',
    ...input.frames.map((f) => `- ${f}`),
    '',
    `Call ${TOOL_NAME} with three to five performances and ${MIN_TOPICS} to ${MAX_TOPICS} topics.`,
  ].join('\n');
}

function tool(frames: readonly string[]) {
  return {
    name: TOOL_NAME,
    description: "Report the subject's performances and its topics, each with its frame, target and cited lines.",
    input_schema: {
      type: 'object' as const,
      properties: {
        performances: { type: 'array', items: { type: 'string' } },
        topics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ask: { type: 'string' },
              scope: { type: 'string' },
              frame: { type: 'string', enum: [...frames] },
              target: { type: 'integer', minimum: 1, maximum: 10 },
              cites: { type: 'array', items: { type: 'string' } },
            },
            required: ['ask', 'scope', 'frame', 'target', 'cites'],
          },
        },
      },
      required: ['performances', 'topics'],
    },
  };
}

const tidy = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * The call's report as a territory. A cite naming no line is dropped; a topic
 * with no ask, a frame not offered or an ask already listed is dropped; the
 * list is cut at fifty. Canonicality is set from the cited documents.
 */
export function readCompiled(
  raw: unknown,
  input: CompileInput,
  texts: readonly TerritoryText[],
): { territory: Territory; dropped: { cites: number; topics: number } } {
  const report = (raw ?? {}) as { performances?: unknown; topics?: unknown };
  const frameOf = new Map(input.frames.map((f) => [f.toLowerCase(), f]));
  const textOf = new Map(texts.map((t) => [t.key, t]));
  const dropped = { cites: 0, topics: 0 };

  const lineOf = (cite: string): string | null => {
    const m = /^\s*(d\d+)\.(\d+)\s*$/i.exec(cite);
    const text = m ? textOf.get(m[1].toLowerCase()) : undefined;
    const item = text ? text.items[Number(m![2]) - 1] : undefined;
    return text && item !== undefined ? `${text.key}: ${item}` : null;
  };

  const seen = new Set<string>();
  const topics: TerritoryTopic[] = [];
  for (const entry of Array.isArray(report.topics) ? report.topics : []) {
    const t = (entry ?? {}) as Record<string, unknown>;
    const ask = tidy(t.ask);
    const frame = frameOf.get(tidy(t.frame).toLowerCase());
    if (!ask || !frame || seen.has(ask.toLowerCase()) || topics.length >= MAX_TOPICS) {
      dropped.topics += 1;
      continue;
    }
    seen.add(ask.toLowerCase());
    const cites = Array.isArray(t.cites) ? t.cites.filter((c): c is string => typeof c === 'string') : [];
    const from: string[] = [];
    for (const cite of cites) {
      const line = lineOf(cite);
      if (line === null) dropped.cites += 1;
      else if (!from.includes(line)) from.push(line);
    }
    const target = Math.min(10, Math.max(1, Math.round(typeof t.target === 'number' ? t.target : 4)));
    topics.push({ ask, scope: tidy(t.scope) || ask, frame, target, from, canonicality: canonicalityFrom(from, texts) });
  }

  const performances = (Array.isArray(report.performances) ? report.performances : [])
    .map(tidy)
    .filter((p) => p !== '')
    .slice(0, MAX_PERFORMANCES);
  const { subject } = input;
  return {
    territory: {
      key: `subject-${subject.id}`,
      name: subject.name,
      subjectLens: subject.name,
      performances,
      roles: [],
      texts: texts.map((t) => ({ ...t, items: [...t.items] })),
      topics,
      goal: { name: subject.name, about: subject.note },
      // The documents were pulled by the preparation already, so the drafter pulls nothing more.
      kind: null,
    },
    dropped,
  };
}

/** Lay out the territory in one call. */
export async function compileTerritory(input: CompileInput & {
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<CompileResult> {
  if (input.frames.length === 0) return { ok: false, detail: 'No frame topics were found near the subject.' };
  const texts = territoryTexts(input.documents);
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey, timeout: COMPILE_CALL_MS - 10_000, maxRetries: 0 });

  let response;
  try {
    response = await client.messages.create({
      model: TERRITORY_COMPILE_MODEL,
      max_tokens: 16_000,
      system: SYSTEM,
      tools: [tool(input.frames)],
      tool_choice: forceTool(TOOL_NAME, TERRITORY_COMPILE_MODEL),
      messages: [{ role: 'user', content: compilePrompt(input, texts) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The territory call failed.' };
  }

  // Before the reply is read: a malformed report still cost what it cost.
  input.onSpend?.({ model: TERRITORY_COMPILE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const read = readCompiled(block.input, input, texts);
  if (read.territory.topics.length === 0) return { ok: false, detail: 'The call reported no topics.' };
  return { ok: true, ...read };
}

// The step ---------------------------------------------------------------

export type CompilePorts = {
  /** The territory already stored on the run, so a call after a stop does not compile twice. */
  stored: (runId: string) => Promise<Territory | null>;
  /** The stored documents, with their units in order, for these items. */
  documents: (items: { itemId: string; matched: number[]; best: number }[]) => Promise<CompileDocument[]>;
  /** The Level 4 frame titles nearest the subject. */
  frames: (subject: { name: string; note: string | null }) => Promise<string[]>;
  compile: (input: CompileInput) => Promise<CompileResult>;
  save: (runId: string, territory: Territory) => Promise<void>;
};

/** Every document the earlier steps found: the matched weeks' documents first, then those pulled. */
export function documentsToRead(
  pulled: readonly Pick<PulledDocument, 'itemId'>[],
  weeks: readonly Pick<MatchedWeek, 'itemId' | 'ordinal' | 'similarity'>[],
): { itemId: string; matched: number[]; best: number }[] {
  const byItem = new Map<string, { itemId: string; matched: number[]; best: number }>();
  for (const week of weeks) {
    const had = byItem.get(week.itemId) ?? { itemId: week.itemId, matched: [], best: 0 };
    if (!had.matched.includes(week.ordinal)) had.matched.push(week.ordinal);
    had.best = Math.max(had.best, week.similarity);
    byItem.set(week.itemId, had);
  }
  for (const doc of pulled) {
    if (!byItem.has(doc.itemId)) byItem.set(doc.itemId, { itemId: doc.itemId, matched: [], best: 0 });
  }
  return [...byItem.values()];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function tally(territory: Territory) {
  const count = (c: string) => territory.topics.filter((t) => t.canonicality === c).length;
  return {
    topics: territory.topics.length,
    canonical: count('canonical'),
    practitioner: count('practitioner'),
    personal: count('personal'),
    documents: territory.texts.length,
  };
}

function finished(territory: Territory, extra: Record<string, unknown> = {}) {
  const counts = tally(territory);
  const summary =
    counts.documents === 0
      ? `No documents were stored, so Dash laid out ${plural(counts.topics, 'topic')} from the frame topics and its own reading. Every topic is marked personal.`
      : `Laid out ${plural(counts.topics, 'topic')} from ${plural(counts.documents, 'document')}: ${counts.canonical} canonical, ${counts.practitioner} practitioner, ${counts.personal} personal.`;
  return {
    state: 'done' as const,
    summary,
    counts,
    detail: {
      ...extra,
      documents: territory.texts.map((t) => ({ key: t.key, itemId: t.itemId ?? null, label: t.label, url: t.url ?? null })),
    },
  };
}

export function compileStep(ports: CompilePorts): StepHandler {
  return async (ctx) => {
    const had = await ports.stored(ctx.run.id);
    if (had) return finished(had, ctx.step.detail ?? {});

    const detail = (ctx.step.detail ?? {}) as { attempts?: number };
    const attempts = detail.attempts ?? 0;
    if (ctx.deadline - ctx.now() < COMPILE_CALL_MS) {
      return { state: 'more', pause: true, summary: 'Laying out the territory in a fresh call, so it has the time it needs.', detail };
    }

    const pulled = ((ctx.steps.get('pull_documents')?.detail ?? {}) as { documents?: PulledDocument[] }).documents ?? [];
    const weeks = ((ctx.steps.get('match_weeks')?.detail ?? {}) as { weeks?: MatchedWeek[] }).weeks ?? [];
    const items = documentsToRead(pulled, weeks);
    const documents = items.length > 0 ? await ports.documents(items) : [];
    const frames = await ports.frames({ name: ctx.subject.name, note: ctx.subject.note });

    const result = await ports.compile({
      subject: { id: ctx.subject.id, name: ctx.subject.name, note: ctx.subject.note, kind: ctx.subject.kind },
      documents,
      frames,
    });
    if (!result.ok) throw new Error(`Laying out the territory failed: ${result.detail}`);
    const { territory, dropped } = result;

    const tries = attempts + 1;
    if (territory.topics.length < MIN_TOPICS && tries < ATTEMPTS) {
      return {
        state: 'more',
        pause: true,
        summary: `The first layout had ${plural(territory.topics.length, 'topic')}, short of ${MIN_TOPICS}; laying it out again.`,
        detail: { attempts: tries },
      };
    }
    const unsourced = unsourcedFrom(territory);
    if (unsourced.length > 0) throw new Error(`The territory cites lines that are not in its documents: ${unsourced.slice(0, 3).join('; ')}`);

    await ports.save(ctx.run.id, territory);
    return finished(territory, { attempts: tries, dropped, frames: frames.length });
  };
}
