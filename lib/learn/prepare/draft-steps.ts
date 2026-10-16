import { topicsLeft, type Territory, type TerritoryTopic } from '@/lib/learn/levels/territory';
import type { CurriculumResult, CurriculumUnit } from '@/lib/learn/graph/curriculum-payload';
import type { CurriculumTerritory } from '@/lib/learn/graph/curriculum';
import type { StepHandler } from './run';

/**
 * Drafting the territory's topics and writing the opening units from it
 * (plan #2276.5): the draft_topics and write_units steps of a subject's
 * preparation.
 *
 * draft_topics goes down the stored territory a few topics at a time. Each
 * call splits the topics still to draft into lanes and drafts the lanes side
 * by side through the territory drafter (lib/learn/levels/territory-run.ts),
 * which writes each topic with its five checks as a draft for approval and
 * gives it its target on the subject's lens. The step records drafted and
 * remaining counts after each call, so the page shows "12 of 38 drafted", and
 * pauses for a fresh function when too little of the call is left for a draft
 * to finish. A topic the drafter turns down twice is given up on and named on
 * the step, so one bad topic cannot hold the run.
 *
 * write_units then reads the opening topics, as drafted, and the opening lines
 * of the documents the territory came from, and writes the subject's opening
 * units from them. It replaces the placeholder units the add wrote from the
 * subject's name, and keeps every unit the person typed, any unit written
 * later and any unit with a passed piece, after the new ones.
 *
 * Pure apart from its ports, so the tests run both steps with fakes.
 */

/** Lanes drafted side by side in one call; each lane is a pair of model calls at a time. */
export const DRAFT_LANES = 4;
/** Topics handed to one lane per call; the drafter stops early when the time is used. */
export const TOPICS_PER_LANE = 3;
/** A draft takes one to three minutes, so none is started with less than this left. */
export const DRAFT_START_MS = 120_000;
/** Kept back from a lane's budget, so its last draft ends before the call does. */
export const DRAFT_FINISH_MS = 90_000;
/** A topic the drafter turns down this many times is given up on. */
export const DRAFT_TRIES = 2;
/** Opening topics given to the units call. */
export const OPENING_TOPICS = 12;
/** Opening lines of each document given to the units call. */
export const OPENING_LINES = 6;
/** The units call is one model call of up to a minute. */
export const UNITS_CALL_MS = 75_000;

export type LaneResult = {
  drafted: { ask: string; id: string; name: string }[];
  failed: { ask: string; detail: string }[];
};

export type DraftTopicsPorts = {
  territory: (runId: string) => Promise<Territory | null>;
  /** The subject's lens, made if it has none; its name is what the drafter targets. */
  lens: (subject: { id: string; name: string }) => Promise<{ id: string; name: string }>;
  /** The asks already on the person's topics, for what is left to draft. */
  asked: () => Promise<(string | null)[]>;
  /** Draft one lane of topics within the budget. */
  draft: (territory: Territory, budgetMs: number) => Promise<LaneResult>;
  /** Give every drafted territory topic its target on the lens; returns how many it has. */
  targets: (lensId: string, topics: readonly TerritoryTopic[]) => Promise<number>;
};

type GivenUp = { ask: string; detail: string; tries: number };
type DraftDetail = { lens?: { id: string; name: string }; failed?: GivenUp[] };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The topics split round-robin into lanes, at most `perLane` each, in territory order. */
export function lanesOf<T>(topics: readonly T[], lanes: number, perLane: number): T[][] {
  const take = topics.slice(0, lanes * perLane);
  const out: T[][] = Array.from({ length: Math.min(lanes, take.length) }, () => []);
  take.forEach((topic, i) => out[i % out.length].push(topic));
  return out;
}

export function draftTopicsStep(ports: DraftTopicsPorts): StepHandler {
  return async (ctx) => {
    const territory = await ports.territory(ctx.run.id);
    if (!territory) return { state: 'skipped', reason: 'No territory was laid out, so there are no topics to draft.' };

    const detail = (ctx.step.detail ?? {}) as DraftDetail;
    const lens = detail.lens ?? (await ports.lens({ id: ctx.subject.id, name: ctx.subject.name }));
    const failed = new Map((detail.failed ?? []).map((f) => [f.ask.trim().toLowerCase(), f]));
    const gaveUp = (t: TerritoryTopic) => (failed.get(t.ask.trim().toLowerCase())?.tries ?? 0) >= DRAFT_TRIES;
    const total = territory.topics.length;

    const tally = (left: readonly TerritoryTopic[]) => {
      const abandoned = left.filter(gaveUp).length;
      const drafted = total - left.length;
      return { counts: { topics: total, drafted, remaining: left.length - abandoned, failed: abandoned }, drafted, abandoned };
    };
    const record = (): Record<string, unknown> => ({ lens, failed: [...failed.values()] });

    const left = topicsLeft(territory, await ports.asked());
    const todo = left.filter((t) => !gaveUp(t));
    if (todo.length === 0) {
      const { counts, drafted, abandoned } = tally(left);
      const targeted = await ports.targets(lens.id, territory.topics);
      return {
        state: 'done',
        summary:
          `Drafted ${plural(drafted, 'topic')} with their checks, ${targeted} with a target on the lens.` +
          (abandoned > 0 ? ` ${plural(abandoned, 'topic')} could not be drafted.` : ''),
        counts: { ...counts, targeted },
        detail: record(),
      };
    }

    const timeLeft = ctx.deadline - ctx.now();
    if (timeLeft < DRAFT_START_MS) {
      const { counts, drafted } = tally(left);
      return {
        state: 'more',
        pause: true,
        summary: `${drafted} of ${total} topics drafted; carrying on in a fresh call.`,
        counts,
        detail: record(),
      };
    }

    // The lens may be named differently from when the territory was laid out.
    const base: Territory = { ...territory, subjectLens: lens.name, kind: null };
    const lanes = lanesOf(todo, DRAFT_LANES, TOPICS_PER_LANE);
    const settled = await Promise.allSettled(lanes.map((topics) => ports.draft({ ...base, topics }, timeLeft - DRAFT_FINISH_MS)));
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (rejected.length === settled.length) throw rejected[0].reason instanceof Error ? rejected[0].reason : new Error(String(rejected[0].reason));

    let draftedNow = 0;
    for (const lane of settled) {
      if (lane.status !== 'fulfilled') continue;
      draftedNow += lane.value.drafted.length;
      for (const f of lane.value.failed) {
        const key = f.ask.trim().toLowerCase();
        const had = failed.get(key);
        failed.set(key, { ask: f.ask, detail: f.detail.slice(0, 200), tries: (had?.tries ?? 0) + 1 });
      }
    }
    const drafted = new Set(
      settled.flatMap((s) => (s.status === 'fulfilled' ? s.value.drafted.map((d) => d.ask.trim().toLowerCase()) : [])),
    );
    const stillLeft = left.filter((t) => !drafted.has(t.ask.trim().toLowerCase()));
    const { counts } = tally(stillLeft);
    return {
      state: 'more',
      summary: `${counts.drafted} of ${total} topics drafted.`,
      counts: { ...counts, lastCall: draftedNow },
      detail: record(),
    };
  };
}

// Write units -------------------------------------------------------------

export type SubjectUnit = {
  id: string;
  ordinal: number;
  title: string;
  /** Written by the add from the subject's name alone. */
  placeholder: boolean;
  /** Has a passed piece, so it is never removed. */
  passed: boolean;
};

export type WriteUnitsPorts = {
  territory: (runId: string) => Promise<Territory | null>;
  /** The drafted names of the territory's topics, keyed by ask lower-cased. */
  names: (asks: readonly string[]) => Promise<Map<string, string>>;
  units: (subjectId: string) => Promise<SubjectUnit[]>;
  write: (input: { subject: string; asked: string | null; territory: CurriculumTerritory }) => Promise<CurriculumResult>;
  /** Remove `remove`, put `units` first, and the kept units after them in their order. */
  replace: (subjectId: string, input: { remove: string[]; units: CurriculumUnit[]; kept: string[] }) => Promise<void>;
};

/** The units call's view of the territory: the opening topics as drafted and how each document opens. */
export function openingTerritory(territory: Territory, names: ReadonlyMap<string, string>, after: readonly string[]): CurriculumTerritory {
  return {
    topics: territory.topics.slice(0, OPENING_TOPICS).map((t) => ({
      name: names.get(t.ask.trim().toLowerCase()) ?? t.ask,
      scope: t.scope,
    })),
    documents: territory.texts.map((text) => ({ label: text.label, lines: text.items.slice(0, OPENING_LINES) })),
    after,
  };
}

/** How many of the opening topics the units name in what they cover. */
export function topicsNamed(units: readonly CurriculumUnit[], topics: readonly { name: string }[]): number {
  const covers = units.map((u) => `${u.title} ${u.covers}`.toLowerCase()).join(' \n ');
  return topics.filter((t) => covers.includes(t.name.toLowerCase())).length;
}

export function writeUnitsStep(ports: WriteUnitsPorts): StepHandler {
  return async (ctx) => {
    const territory = await ports.territory(ctx.run.id);
    if (!territory) return { state: 'skipped', reason: 'No territory was laid out, so the opening units stay as they were.' };

    const units = (await ports.units(ctx.subject.id)).sort((a, b) => a.ordinal - b.ordinal);
    const replaceable = units.filter((u) => u.placeholder && !u.passed);
    const kept = units.filter((u) => !replaceable.includes(u));
    if (units.length > 0 && replaceable.length === 0) {
      return {
        state: 'skipped',
        reason: `Kept the ${plural(units.length, 'unit')} the subject already had, since none was a placeholder from when it was added.`,
      };
    }
    if (ctx.deadline - ctx.now() < UNITS_CALL_MS) {
      return { state: 'more', pause: true, summary: 'Writing the opening units in a fresh call.' };
    }

    const names = await ports.names(territory.topics.slice(0, OPENING_TOPICS).map((t) => t.ask));
    const opening = openingTerritory(territory, names, kept.map((u) => u.title));
    const result = await ports.write({ subject: ctx.subject.name, asked: ctx.subject.note, territory: opening });
    if (!result.ok) throw new Error(`Writing the opening units failed: ${result.detail}`);

    const keptTitles = new Set(kept.map((u) => u.title.trim().toLowerCase()));
    const fresh = result.units.filter((u) => !keptTitles.has(u.title.trim().toLowerCase()));
    if (fresh.length === 0) throw new Error('Writing the opening units failed: every unit repeated one the subject keeps.');
    await ports.replace(ctx.subject.id, { remove: replaceable.map((u) => u.id), units: fresh, kept: kept.map((u) => u.id) });

    const named = topicsNamed(fresh, opening.topics);
    return {
      state: 'done',
      summary:
        `Wrote ${plural(fresh.length, 'opening unit')} from the territory, naming ${plural(named, 'topic')} they teach.` +
        (kept.length > 0 ? ` Kept ${plural(kept.length, 'unit')} after them.` : ''),
      counts: { units: fresh.length, replaced: replaceable.length, kept: kept.length, topicsNamed: named },
      detail: { units: fresh.map((u) => u.title) },
    };
  };
}
