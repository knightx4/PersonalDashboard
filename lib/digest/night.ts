import { featureAbove, type PlanParentRow } from '@/lib/changelog/entries';
import type { PlanItem } from '@/lib/plan/load';
import { overnightStanding, type OvernightRun, type OvernightStanding } from '@/lib/plan/overnight';
import { oneLine } from './build';

/**
 * The night the runner just had, as the morning summary says it.
 *
 * The runner works while nobody is watching -- a cron tick fires one feature,
 * waits for it, fires the next -- and the whole of what it did is scattered
 * across three tables by morning. This gathers it into the one thing you want
 * at breakfast: what it worked, what closed, what it left stopped on you, and
 * why it stopped.
 *
 * Pure, beside `build.ts` and for the same reason: what counts as part of the
 * night is a rule, and a rule belongs somewhere it can be tested without a
 * database. `inngest/dev/digest.ts` does the reading and stores the answer on
 * the day's row; `lib/digest/load.ts` reads it back.
 *
 * -- Where the facts come from --
 *
 * The fires are `plan_runs` rows with `job = 'feature'` from the night's
 * window. What closed is `plan_items.completed_at` in the same window. The
 * tick writes no record of its own beyond the `plan_overnight_runs` row, so
 * there is nothing else to read.
 *
 * Nothing here reads `plan_runs.status`. It would be the obvious way to say
 * how each feature's session went, and at four in the morning it is a lie:
 * `endQuietRuns` is the only thing that writes a run back, it runs from the
 * plan page's render, and nobody has the plan page open at four in the
 * morning. Every run of the night still reads `started` with no error on it,
 * so a report counting finished against failed off that column would call the
 * whole night unfinished. What a feature's session actually achieved is read
 * the way the tick reads it -- from the steps that closed underneath it -- and
 * that is what `closed` is.
 *
 * -- One vocabulary --
 *
 * The same night is also drawn on the plan page by the control in #583, and
 * the two must not describe it differently. So the state is
 * `overnightStanding`'s answer rather than a fresh reading of the booleans,
 * the reason it ended is the sentence on the row printed verbatim, and the
 * budget is the same two numbers, in the same words.
 *
 * Since #633 the control reads this file rather than only agreeing with it: it
 * calls `nightFrom` on the live night and prints `nightBudgetLine` and
 * `nightClosedLine`, so a night the page says fired two features cannot be a
 * night the morning report says fired three. The control used to count the
 * budget the other way round -- "2 of 6 left" against the report's "4 of 6
 * spent" -- and that is gone: leading with what the night has got through is
 * the whole of #633, and two readings of one pair of numbers on one page is
 * the arithmetic it was meant to save.
 */

/** One press the runner made: a `plan_runs` row with `job = 'feature'`. */
export type NightFire = {
  /** The feature it was sent at. Null on a row that names no step. */
  planItemId: string | null;
  /** When the run was recorded. */
  at: string;
};

/** A feature or a step, as a line of the report names it. */
export type DigestNightRef = { ref: string; title: string };

export type DigestNightStep = DigestNightRef & {
  /** The feature it sits under, or null when it is one. */
  feature: DigestNightRef | null;
  /**
   * What a blocked step says it needs, in the sentence the block wrote. Null
   * on a step that closed, and on a blocked one with nothing recorded.
   */
  ask: string | null;
};

/** What the runner did between the button and the morning. */
export type DigestNight = {
  /**
   * Running, Held or Stopped. `off` is not one of them: a row that is not
   * running and carries no reason is an account that has never had a night,
   * and there is nothing to report on.
   */
  standing: Exclude<OvernightStanding, 'off'>;
  /** When the button was pressed. The window everything below is read over. */
  startedAt: string;
  /** When it stopped, or null when it was still going at breakfast. */
  endedAt: string | null;
  /** Why it stopped, in the row's own sentence. Null on a night still going. */
  endedReason: string | null;
  /** Null when the run was started with no cap. */
  featuresBudget: number | null;
  /** Null exactly when `featuresBudget` is. */
  featuresLeft: number | null;
  /** Every feature it fired, in the order it fired them. */
  features: (DigestNightRef & { at: string })[];
  /**
   * The last press it made, and when -- the feature it is on if it is still
   * going. Null on a night that has fired nothing.
   *
   * Not the last of `features`, and the difference is the whole reason this
   * is its own field. `features` is one line per feature however many times it
   * was fired, held in the order the night *first* reached each one; a runner
   * that came back to an earlier feature is still working that feature, and
   * the last element of that list would name the wrong one. So this is read
   * from the fires themselves, undeduplicated, newest wins.
   *
   * Added for the plan page's control (#633), which says what the night is
   * doing right now rather than what it did. The morning report has no use for
   * it -- by breakfast the night is over -- but a second reading of the same
   * fires kept somewhere else is exactly the drift `nightFrom` exists to stop.
   */
  lastFire: (DigestNightRef & { at: string }) | null;
  /** Every step that closed while it ran. */
  closed: DigestNightStep[];
  /** Every step that is stopped on you now and was written to while it ran. */
  blocked: DigestNightStep[];
};

/**
 * How many rows of each list the page prints before it counts the rest.
 *
 * The stored night keeps every row, the way `happened` keeps every event
 * beside it: the cap is a reading of the record rather than the record, and a
 * night that closed thirty steps should not lose twenty of them to a constant
 * somebody chose for a panel.
 */
export const MAX_NIGHT_ROWS = 10;

/** The first `limit` of a list, and how many were left. */
export function nightRows<T>(
  rows: readonly T[],
  limit = MAX_NIGHT_ROWS,
): { shown: T[]; more: number } {
  return { shown: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}

/** The plan rows the walk to a step's feature needs, and nothing else. */
function parentsOf(items: readonly PlanItem[]): PlanParentRow[] {
  return items.map((item) => ({
    id: item.id,
    number: item.number,
    title: item.title,
    parentId: item.parentId,
  }));
}

function refOf(item: Pick<PlanItem, 'number' | 'title'>): DigestNightRef {
  return { ref: `#${item.number}`, title: oneLine(item.title) };
}

function featureOf(
  item: PlanItem,
  byId: ReadonlyMap<string, PlanParentRow>,
): DigestNightRef | null {
  const above = featureAbove(item.parentId, byId);
  return above ? { ref: `#${above.number}`, title: oneLine(above.title) } : null;
}

/** Whether an instant falls inside the night: at or after it started. */
function inside(at: string | null, startedAt: number): boolean {
  if (!at) return false;
  const when = new Date(at).getTime();
  return Number.isFinite(when) && when >= startedAt;
}

/**
 * The night to report, or nothing.
 *
 * Three ways there is nothing. The account has never started one, which is
 * `off`. The row has no start, which the check constraint makes impossible and
 * which would leave every window below unbounded. And the night ended before
 * the window this summary covers -- the row is the account's rather than the
 * night's, so a night that ended on Tuesday is still sitting there on Friday,
 * and reporting it again every morning would be the same news four times.
 *
 * A night still running when the cron fires is a real case rather than an
 * edge: the daily cron goes off at a fixed hour and a long night can outlast
 * it. It is reported as what it is -- the night so far -- which is why
 * `endedAt` and `endedReason` are allowed to be null here.
 */
export function nightFrom(input: {
  run: OvernightRun | null;
  fires: readonly NightFire[];
  items: readonly PlanItem[];
  /** The start of the window the summary covers. */
  since: string;
}): DigestNight | null {
  const { run } = input;
  const standing = overnightStanding(run);
  if (!run || standing === 'off' || !run.startedAt) return null;
  if (run.endedAt !== null && new Date(run.endedAt).getTime() < new Date(input.since).getTime()) {
    return null;
  }

  const startedAt = new Date(run.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return null;

  const items = input.items;
  const byId = new Map(parentsOf(items).map((row) => [row.id, row]));
  const itemById = new Map(items.map((item) => [item.id, item]));

  // One line per feature however many times it was fired: a feature the runner
  // came back to is still one feature it worked, and the count of presses is
  // the budget line's job. Oldest first, which is the order it chose them in.
  const seen = new Set<string>();
  const features = [...input.fires]
    .filter((fire) => fire.planItemId !== null && inside(fire.at, startedAt))
    .sort((a, b) => a.at.localeCompare(b.at))
    .flatMap((fire) => {
      const item = itemById.get(fire.planItemId as string);
      if (!item || seen.has(item.id)) return [];
      seen.add(item.id);
      return [{ ...refOf(item), at: fire.at }];
    });

  // The newest press inside the window, whatever it was for. Read off the
  // fires rather than off `features` above, which is deduplicated and ordered
  // by first sight; see the field's own note.
  const lastFire =
    [...input.fires]
      .filter((fire) => fire.planItemId !== null && inside(fire.at, startedAt))
      .sort((a, b) => b.at.localeCompare(a.at))
      .flatMap((fire) => {
        const item = itemById.get(fire.planItemId as string);
        return item ? [{ ...refOf(item), at: fire.at }] : [];
      })[0] ?? null;

  // Everything that closed while it was running. Nothing on a plan row says
  // which press closed it, and at three in the morning there is only one thing
  // pressing anything -- but a step you closed yourself before bed would be in
  // here too, which is the honest cost of having no record of the tick.
  const closed = items
    .filter(
      (item) =>
        item.kind !== 'decision' && item.status === 'done' && inside(item.completedAt, startedAt),
    )
    .sort((a, b) => (a.completedAt as string).localeCompare(b.completedAt as string))
    .map((item) => ({ ...refOf(item), feature: featureOf(item, byId), ask: null }));

  // Blocked now, and written to during the night. `updated_at` is the only
  // stamp a block leaves -- there is no blocked_at column -- so this is "the
  // row moved while the runner was running and it now reads blocked", which is
  // the same rule the plan page's own ordering is built on.
  const blocked = items
    .filter((item) => item.status === 'blocked' && inside(item.updatedAt, startedAt))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((item) => ({
      ...refOf(item),
      feature: featureOf(item, byId),
      ask: item.blockAsk ? oneLine(item.blockAsk, 200) : null,
    }));

  return {
    standing,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    endedReason: run.endedReason,
    featuresBudget: run.featuresBudget,
    featuresLeft: run.featuresLeft,
    features,
    lastFire,
    closed,
    blocked,
  };
}

/**
 * What the night cost, in the control's words read the other way round.
 *
 * The plan page says "2 of 6 features left", because what it is asked is
 * whether the night is worth leaving alone. A report of a night that is over
 * is asked the opposite, and the answer is the same pair of numbers: "4 of 6
 * features spent". One word apart on purpose -- a third phrasing would make
 * the reader work out whether it was the same quantity.
 */
export function nightBudgetLine(
  night: Pick<DigestNight, 'featuresBudget' | 'featuresLeft' | 'features'>,
): string {
  // A run with no cap has no "of" to say, so it says what it fired. The fires
  // themselves are the only source for that number -- which is why this is the
  // one case that counts them rather than reading the columns: there is no
  // budget to subtract a remainder from.
  if (night.featuresBudget === null || night.featuresLeft === null) {
    const fired = night.features.length;
    return `${fired} ${fired === 1 ? 'feature' : 'features'} fired, no limit`;
  }
  const spent = Math.max(0, night.featuresBudget - night.featuresLeft);
  return `${spent} of ${night.featuresBudget} ${
    night.featuresBudget === 1 ? 'feature' : 'features'
  } spent`;
}

/**
 * What the night has got through, in steps.
 *
 * The other half of the totals, and a sentence rather than a number because a
 * bare `9` beside `2 of 6 features spent` reads as part of the budget. A night
 * that has closed nothing says so in words for the same reason the morning
 * report does: nothing closed is the outcome worth noticing, and a zero is
 * easy to read past.
 */
export function nightClosedLine(night: Pick<DigestNight, 'closed'>): string {
  const n = night.closed.length;
  if (n === 0) return 'no steps closed';
  return `${n} ${n === 1 ? 'step' : 'steps'} closed`;
}

/**
 * The one sentence under the state word.
 *
 * A stopped night says the sentence on its row and nothing else: five things
 * can end a night, each writes its own reason as a whole sentence, and the
 * value of that is lost the moment something rewords one on the way out.
 *
 * The other two are the cron catching a night mid-flight, which the fixed hour
 * makes ordinary rather than rare. Neither pretends the night is over.
 */
export function nightLine(night: DigestNight): string {
  switch (night.standing) {
    case 'stopped':
      return night.endedReason ?? '';
    case 'paused':
      return 'It was held when this was written. What was building finished; nothing new was fired.';
    default:
      return 'It was still running when this was written, so this is the night so far.';
  }
}

/**
 * The last night, read after it has ended, for the Status panel on Dash.
 *
 * `nightFrom` counts every step that closed after the night started, which is
 * right on the morning it is reported. Days later it is not: a step you closed
 * by hand on Thursday would be counted as work Tuesday's night did. So a night
 * that has stopped keeps only the steps under a feature it actually fired.
 *
 * The end time cannot bound it instead. A night ends when it has spent its
 * budget or reached its stop time, and the session building its last feature
 * is still running then and closes its steps afterwards.
 *
 * A night still going is returned exactly as `nightFrom` reads it, so the
 * Status panel and the plan page agree about the night in progress.
 */
export function lastNightFrom(input: {
  run: OvernightRun | null;
  fires: readonly NightFire[];
  items: readonly PlanItem[];
}): DigestNight | null {
  const { run } = input;
  if (!run?.startedAt) return null;
  const night = nightFrom({ ...input, since: run.startedAt });
  if (!night || night.standing !== 'stopped') return night;

  const startedAt = new Date(run.startedAt).getTime();
  const fired = new Set(
    input.fires
      .filter((fire) => fire.planItemId !== null && inside(fire.at, startedAt))
      .map((fire) => fire.planItemId as string),
  );
  const parentOf = new Map(input.items.map((item) => [item.id, item.parentId]));
  const refToId = new Map(input.items.map((item) => [`#${item.number}`, item.id]));

  // Walk up from the step itself, so a fired feature that is not at the root
  // of the tree still claims the steps beneath it.
  const underFired = (ref: string): boolean => {
    const seen = new Set<string>();
    let current = refToId.get(ref) ?? null;
    while (current && !seen.has(current)) {
      if (fired.has(current)) return true;
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
    return false;
  };

  return {
    ...night,
    closed: night.closed.filter((step) => underFired(step.ref)),
    blocked: night.blocked.filter((step) => underFired(step.ref)),
  };
}
