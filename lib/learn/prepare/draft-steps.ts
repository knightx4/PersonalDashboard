import { topicsLeft, type Territory, type TerritoryTopic } from '@/lib/learn/levels/territory';
import type { CurriculumResult, CurriculumUnit } from '@/lib/learn/graph/curriculum-payload';
import type { CurriculumTerritory } from '@/lib/learn/graph/curriculum';
import type { StepHandler } from './run';

/**
 * Drafting the territory's topics and writing the opening units from it
 * (plan #2276.5): the draft_topics and write_units steps of a subject's
 * preparation.
 *
 * draft_topics queues the stored territory's topics for the routine
 * (learn 0193) through the territory drafter (lib/learn/levels/territory-run.ts),
 * which drafts nothing itself: the routine's session writes each topic with
 * its five checks, gives it its target on the subject's lens and approves it.
 * The step then waits: it ends the call without starting another, and the
 * routine's script (scripts/learn-drafts.ts) or the daily cron resumes it.
 * Each resume records drafted and waiting counts, so the page shows "12 of 38
 * drafted", and is done once nothing it queued is still waiting. A topic the
 * routine could not draft is tried again once, then given up on and named on
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

/** A topic the routine turns down this many times is given up on. */
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
  /** Queue the territory's topics for the routine and start it; returns what could not be queued. */
  draft: (territory: Territory, runId: string) => Promise<{ queued: number; failed: LaneResult['failed'] }>;
  /** This run's requests still waiting for the routine, and the ones it could not draft since the last call. */
  pending: (runId: string) => Promise<{ waiting: string[]; failed: { id: string; ask: string; detail: string }[] }>;
  /** Give every drafted territory topic its target on the lens; returns how many it has. */
  targets: (lensId: string, topics: readonly TerritoryTopic[]) => Promise<number>;
  /**
   * Approve each drafted territory topic whose rows all cite a source, with the
   * drafted checks unchanged (plan #2276.10); returns how many of these topics
   * are approved now and the ones left as drafts, with why.
   */
  approve: (topics: readonly TerritoryTopic[]) => Promise<ApprovalResult>;
};

export type KeptDraft = { ask: string; name: string; reason: string };
export type ApprovalResult = { approved: number; kept: KeptDraft[] };

type GivenUp = { ask: string; detail: string; tries: number };
/** `seen` is the failed requests already counted as a try, so a resume counts each once. */
type DraftDetail = { lens?: { id: string; name: string }; failed?: GivenUp[]; kept?: KeptDraft[]; seen?: string[] };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function draftTopicsStep(ports: DraftTopicsPorts): StepHandler {
  return async (ctx) => {
    const territory = await ports.territory(ctx.run.id);
    if (!territory) return { state: 'skipped', reason: 'No territory was laid out, so there are no topics to draft.' };

    const detail = (ctx.step.detail ?? {}) as DraftDetail;
    const seen = new Set(detail.seen ?? []);
    const lens = detail.lens ?? (await ports.lens({ id: ctx.subject.id, name: ctx.subject.name }));
    const failed = new Map((detail.failed ?? []).map((f) => [f.ask.trim().toLowerCase(), f]));
    const gaveUp = (t: TerritoryTopic) => (failed.get(t.ask.trim().toLowerCase())?.tries ?? 0) >= DRAFT_TRIES;
    const total = territory.topics.length;

    const tally = (left: readonly TerritoryTopic[]) => {
      const abandoned = left.filter(gaveUp).length;
      const drafted = total - left.length;
      return { counts: { topics: total, drafted, remaining: left.length - abandoned, failed: abandoned }, drafted, abandoned };
    };
    const record = (kept?: KeptDraft[]): Record<string, unknown> => ({
      lens,
      failed: [...failed.values()],
      seen: [...seen],
      ...(kept ? { kept } : {}),
    });

    const left = topicsLeft(territory, await ports.asked());
    const key = (ask: string) => ask.trim().toLowerCase();
    const giveUp = (f: { ask: string; detail: string }) => {
      const had = failed.get(key(f.ask));
      failed.set(key(f.ask), { ask: f.ask, detail: f.detail.slice(0, 200), tries: (had?.tries ?? 0) + 1 });
    };
    const before = await ports.pending(ctx.run.id);
    for (const f of before.failed) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      giveUp(f);
    }
    const waiting = new Set(before.waiting.map(key));
    const todo = left.filter((t) => !gaveUp(t) && !waiting.has(key(t.ask)));

    if (todo.length === 0 && waiting.size === 0) {
      const { counts, drafted, abandoned } = tally(left);
      const targeted = await ports.targets(lens.id, territory.topics);
      const { approved, kept } = await ports.approve(territory.topics);
      return {
        state: 'done',
        summary:
          `Drafted ${plural(drafted, 'topic')} with their checks, ${targeted} with a target on the lens.` +
          ` ${approved} approved` +
          (kept.length > 0 ? `, ${kept.length} left as ${kept.length === 1 ? 'a draft' : 'drafts'} for a row that cites nothing.` : '.') +
          (abandoned > 0 ? ` ${plural(abandoned, 'topic')} could not be drafted.` : ''),
        counts: { ...counts, targeted, approved, kept: kept.length },
        detail: record(kept),
      };
    }

    let queued = 0;
    if (todo.length > 0) {
      // The lens may be named differently from when the territory was laid out.
      const base: Territory = { ...territory, subjectLens: lens.name, kind: null };
      const result = await ports.draft({ ...base, topics: todo }, ctx.run.id);
      result.failed.forEach(giveUp);
      queued = result.queued;
    }
    const { counts, drafted } = tally(left);
    const withDash = waiting.size + queued;
    if (withDash === 0) {
      // Every topic left failed to queue: try again in this call, until each is given up on.
      return { state: 'more', summary: `${drafted} of ${total} topics drafted.`, counts, detail: record() };
    }
    return {
      state: 'more',
      pause: true,
      wait: true,
      summary: `${drafted} of ${total} topics drafted; ${plural(withDash, 'topic')} with Dash in a routine.`,
      counts: { ...counts, withDash },
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
    if (!territory) {
      return { state: 'skipped', reason: 'No territory was laid out, so there is nothing to write the opening units from.' };
    }

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
