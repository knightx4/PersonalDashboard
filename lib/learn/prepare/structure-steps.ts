import type { GoalKind, ProviderId } from '@/lib/learn/goal-kind';
import { GOAL_KIND_LABELS, isGoalKind, KIND_REASON_MAX, providersForKind } from '@/lib/learn/goal-kind';
import type { ProviderRun } from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { StepHandler } from './run';

/**
 * The first three preparation steps (plan #2276.3): classify the subject, pull
 * the structure documents its kind calls for into the bank, and match the
 * stored weeks that cover it.
 *
 * Each is a function of ports, so the tests run them without a model, a
 * network or a database; the live ports are in handlers.ts. All three keep the
 * runner's resume contract: what a call learned is written to the step's
 * `detail`, a call that is out of time returns `more`, and calling again
 * carries on from the detail.
 */

// Classify ---------------------------------------------------------------

export type SubjectKindRow = { kind: GoalKind | null; by: 'model' | 'person' | null; reason: string | null };

export type ClassifyPorts = {
  read: (subjectId: string) => Promise<SubjectKindRow>;
  classify: (input: { name: string; note: string | null }) => Promise<
    { ok: true; kind: GoalKind; reason: string } | { ok: false; detail: string }
  >;
  /**
   * Write kind, reason, by, model and time together, only on a row with no
   * kind yet. False when the row had one by then (the person chose first).
   */
  write: (subjectId: string, answer: { kind: GoalKind; reason: string }) => Promise<boolean>;
};

function kindLine(row: SubjectKindRow): string {
  const label = row.kind ? GOAL_KIND_LABELS[row.kind].label : 'No kind';
  const who = row.by === 'person' ? 'set by you' : 'chosen by Dash';
  return `${label}, ${who}${row.reason ? `: ${row.reason}` : '.'}`;
}

export function classifyStep(ports: ClassifyPorts): StepHandler {
  return async (ctx) => {
    const had = await ports.read(ctx.subject.id);
    if (had.kind) return { state: 'done', summary: kindLine(had), detail: { kind: had.kind, by: had.by, reason: had.reason } };

    const result = await ports.classify({ name: ctx.subject.name, note: ctx.subject.note });
    if (!result.ok) throw new Error(`Classifying the subject failed: ${result.detail}`);
    const reason = result.reason.replace(/\s+/g, ' ').trim().slice(0, KIND_REASON_MAX);

    const written = await ports.write(ctx.subject.id, { kind: result.kind, reason });
    const now = written ? { kind: result.kind, by: 'model' as const, reason } : await ports.read(ctx.subject.id);
    return { state: 'done', summary: kindLine(now), detail: { kind: now.kind, by: now.by, reason: now.reason } };
  };
}

// Pull documents ---------------------------------------------------------

export type PulledDocument = {
  itemId: string;
  title: string;
  provider: string;
  url: string;
  licence: string;
  units: number;
};

export type PullPorts = {
  /** The providers that have code. */
  wired: () => readonly ProviderId[];
  /** Run one provider for this subject; null when it has no code. */
  run: (provider: ProviderId, subject: { name: string; note: string | null }) => Promise<ProviderRun | null>;
  /** Title, provider and link of stored documents, by item id. */
  describe: (itemIds: string[]) => Promise<PulledDocument[]>;
};

type PullDetail = {
  kind: GoalKind;
  providersDone: ProviderId[];
  /** Providers the kind names that have no code yet. */
  unwired: ProviderId[];
  /** Providers whose search failed, with why. */
  failed: { provider: ProviderId; detail: string }[];
  /** Item ids stored so far, in the order found, and the units each has. */
  items: { itemId: string; units: number }[];
  documents?: PulledDocument[];
};

function readPullDetail(detail: Record<string, unknown> | undefined, kind: GoalKind): PullDetail {
  const d = (detail ?? {}) as Partial<PullDetail>;
  if (d.kind !== kind) return { kind, providersDone: [], unwired: [], failed: [], items: [] };
  return {
    kind,
    providersDone: d.providersDone ?? [],
    unwired: d.unwired ?? [],
    failed: d.failed ?? [],
    items: d.items ?? [],
  };
}

/** A provider is not started with less than this left in the call; the next call starts it. */
const PROVIDER_MARGIN_MS = 60_000;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function pullStep(ports: PullPorts, kindOf: (subjectId: string) => Promise<GoalKind | null>): StepHandler {
  return async (ctx) => {
    const kind = await kindOf(ctx.subject.id);
    if (!kind || !isGoalKind(kind)) throw new Error('The subject has no kind, so there is nothing to pull for.');
    const planned = providersForKind(kind);
    const wired = new Set(ports.wired());
    const label = GOAL_KIND_LABELS[kind].label.toLowerCase();

    if (!planned.some((id) => wired.has(id))) {
      return {
        state: 'skipped',
        reason: `No source for a ${label} is wired yet, so no documents were pulled. Went on with what the bank already holds.`,
        detail: { kind, providersDone: [], unwired: [...planned], failed: [], items: [], documents: [] },
      };
    }

    const state = readPullDetail(ctx.step.detail, kind);
    for (const id of planned) {
      if (state.providersDone.includes(id)) continue;
      if (!wired.has(id)) {
        if (!state.unwired.includes(id)) state.unwired.push(id);
        state.providersDone.push(id);
        continue;
      }
      if (state.providersDone.length > 0 && ctx.now() > ctx.deadline - PROVIDER_MARGIN_MS) {
        return {
          state: 'more',
          summary: `Searched ${state.providersDone.length} of ${planned.length} sources.`,
          detail: { ...state },
        };
      }
      const run = await ports.run(id, { name: ctx.subject.name, note: ctx.subject.note });
      if (run && !run.ok) state.failed.push({ provider: id, detail: run.detail.slice(0, 200) });
      if (run?.ok) {
        for (const line of run.lines) {
          if (line.status === 'stored' && !state.items.some((i) => i.itemId === line.itemId)) {
            state.items.push({ itemId: line.itemId, units: line.units });
          }
        }
      }
      state.providersDone.push(id);
    }

    const documents = state.items.length > 0 ? await ports.describe(state.items.map((i) => i.itemId)) : [];
    state.documents = documents;
    const searched = planned.length - state.unwired.length;
    const failedNote = state.failed.length > 0 ? ` ${plural(state.failed.length, 'search')} failed.` : '';
    const sources = new Set(documents.map((d) => d.provider)).size;
    const summary =
      documents.length === 0
        ? `Searched ${plural(searched, 'source')} and stored no documents.${failedNote}`
        : `Stored ${plural(documents.length, 'document')} from ${plural(sources, 'source')}.${failedNote}`;
    return {
      state: 'done',
      summary,
      counts: {
        documents: documents.length,
        units: documents.reduce((n, d) => n + d.units, 0),
        searched,
        failed: state.failed.length,
      },
      detail: { ...state },
    };
  };
}

// Match weeks ------------------------------------------------------------

export type MatchedWeek = {
  segmentId: string;
  itemId: string;
  ordinal: number;
  label: string | null;
  heading: string;
  similarity: number;
};

export type MatchPorts = {
  /** Embed the units that have no vector. Not finished when the deadline came first. */
  embed: (deadline: number) => Promise<{ finished: boolean }>;
  find: (subject: { name: string; note: string | null }) => Promise<
    { ok: true; weeks: MatchedWeek[] } | { ok: false; detail: string }
  >;
};

/** Weeks kept on the step for the territory step to read. */
export const MATCHED_WEEKS_KEPT = 150;

export function matchStep(ports: MatchPorts): StepHandler {
  return async (ctx) => {
    const embedded = await ports.embed(ctx.deadline);
    if (!embedded.finished) return { state: 'more', summary: 'Embedding the new weeks so they can be searched.' };

    const found = await ports.find({ name: ctx.subject.name, note: ctx.subject.note });
    if (!found.ok) throw new Error(`Matching the weeks failed: ${found.detail}`);
    const weeks = [...found.weeks].sort((a, b) => b.similarity - a.similarity).slice(0, MATCHED_WEEKS_KEPT);
    const documents = new Set(found.weeks.map((w) => w.itemId)).size;
    return {
      state: 'done',
      summary:
        found.weeks.length === 0
          ? 'No stored week covers this subject yet.'
          : `Found ${plural(found.weeks.length, 'week')} that cover it, across ${plural(documents, 'document')}.`,
      counts: { weeks: found.weeks.length, documents },
      detail: { weeks },
    };
  };
}
