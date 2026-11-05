/**
 * The builder, a person on People who knows the person's Dev work (plan
 * #2854.5).
 *
 * The builder is a you.board_advisors row under the key `builder` (you
 * 0044), drawn and texted like any other person on People. Three things set
 * it apart, and they live here:
 *
 *   - What it reads before each reply. In place of todos and goals, the live
 *     layer holds "Dev now": what is waiting on the person, what is building
 *     and what shipped in the last two days, read fresh for every reply
 *     (lib/you/builder-brief.ts reads the rows, `devBriefOf` sorts them).
 *   - How it is told who it is. A mentor is told it is one of the person's
 *     mentors; the builder is told it builds the app with them, and is given
 *     BUILDER_RULES after its card: three short texts for "what's going on",
 *     detail only when asked, and a step on the plan for "build me X".
 *   - Who it talks to. It is never seated at the board (joins_meetings is
 *     false) and has no brain, so the Council's daily notes leave it out; it
 *     texts first by its rule in lib/you/first-texts.ts instead.
 *
 * Pure and free of the database, so the tests fix the clock.
 */

import { whenDate, zoneClock } from '@/lib/core/when';

/** The builder's key in you.board_advisors, and the key its first-text rule is under. */
export const BUILDER_KEY = 'builder';

export function isBuilder(advisor: { key: string } | null | undefined): boolean {
  return advisor?.key === BUILDER_KEY;
}

/** What it shipped counts back this far. */
export const SHIPPED_WINDOW_MS = 48 * 60 * 60 * 1000;
/** A session report older than this is not building any more (lib/plan/now.ts GONE_AFTER_MS). */
export const REPORT_GONE_MS = 2 * 60 * 60 * 1000;
/** How many rows each section lists; the rest are counted. */
export const LIST_MAX = 6;
/** The longest ask or action a line quotes. */
const QUOTE_MAX = 140;
const TITLE_MAX = 70;

/** Why a row waits on the person, in the words the brief uses. */
export type WaitingWhy = 'blocked' | 'setup' | 'question' | 'proposal' | 'run question';

export type DevBrief = {
  waiting: { ref: string | null; title: string; why: WaitingWhy; ask: string | null }[];
  building: { ref: string | null; title: string | null; action: string; needs: string | null; at: string }[];
  shipped: { ref: string; title: string; at: string }[];
};

/** A plan row, as much as the brief reads of it. */
export type BriefItem = {
  id: string;
  number: number;
  title: string;
  status: string;
  kind: string;
  completedAt: string | null;
};

/** A row of lib/plan/waiting.ts's list. */
export type BriefWaiting = {
  id: string;
  number: number;
  title: string;
  health: 'unanswered' | 'proposed' | 'blocked' | 'setup';
  ask: string | null;
};

/** A run waiting on the person's answer (lib/plan/run-answer.ts). */
export type BriefRunQuestion = { runId: string; about: string; body: string | null };

/** A core.session_progress row. */
export type BriefProgress = {
  planItemId: string | null;
  planRunId: string | null;
  state: string;
  action: string;
  needs: string | null;
  updatedAt: string;
};

/** A plan run with a session on it now. */
export type BriefRun = { id: string; planItemId: string; status: string; createdAt: string; lastPushSubject: string | null };

const WHY: Record<BriefWaiting['health'], WaitingWhy> = {
  blocked: 'blocked',
  setup: 'setup',
  unanswered: 'question',
  proposed: 'proposal',
};
const WHY_ORDER: Record<WaitingWhy, number> = { blocked: 0, setup: 1, 'run question': 2, question: 3, proposal: 4 };

const ms = (at: string | null | undefined): number => {
  const value = at ? Date.parse(at) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
};

const line = (text: string | null | undefined, max: number): string | null => {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!one) return null;
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/**
 * The rows sorted into the three things the builder keeps up with: what
 * waits on the person (blocked first, then setup, then questions, then
 * proposals), what is building (a session's own report where it made one,
 * else the run the plan knows is going), and what shipped in the last two
 * days, newest first.
 */
export function devBriefOf(input: {
  items: readonly BriefItem[];
  /** `#2854.5` for a row, by its number. */
  refOf: (number: number) => string;
  waiting: readonly BriefWaiting[];
  runQuestions: readonly BriefRunQuestion[];
  progress: readonly BriefProgress[];
  runs: readonly BriefRun[];
  now: number;
}): DevBrief {
  const byId = new Map(input.items.map((item) => [item.id, item]));
  const named = (id: string | null) => {
    const item = id ? byId.get(id) : undefined;
    return item ? { ref: input.refOf(item.number), title: item.title } : { ref: null, title: null };
  };

  const waiting: DevBrief['waiting'] = [
    ...input.waiting.map((row) => ({
      ref: input.refOf(row.number),
      title: row.title,
      why: WHY[row.health],
      ask: row.ask,
    })),
    ...input.runQuestions.map((q) => ({ ref: null, title: q.about, why: 'run question' as const, ask: q.body })),
  ].sort((a, b) => WHY_ORDER[a.why] - WHY_ORDER[b.why]);

  const building: DevBrief['building'] = [];
  const reportedRuns = new Set<string>();
  const reportedSteps = new Set<string>();
  const live = new Set(input.runs.map((run) => run.id));
  const reports = [...input.progress].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  for (const report of reports) {
    if (report.planRunId) reportedRuns.add(report.planRunId);
    if (report.planItemId) reportedSteps.add(report.planItemId);
    if (report.state !== 'working' && report.state !== 'waiting') continue;
    if (input.now - ms(report.updatedAt) >= REPORT_GONE_MS) continue;
    if (report.planRunId && !live.has(report.planRunId)) continue;
    building.push({
      ...named(report.planItemId),
      action: report.action,
      needs: report.state === 'waiting' ? report.needs || 'your answer' : null,
      at: report.updatedAt,
    });
  }
  for (const run of input.runs) {
    if (reportedRuns.has(run.id) || reportedSteps.has(run.planItemId)) continue;
    building.push({
      ...named(run.planItemId),
      action: run.lastPushSubject ? `Pushed: ${run.lastPushSubject}` : 'Started; no report yet',
      needs: run.status === 'awaiting_input' ? 'your answer' : null,
      at: run.createdAt,
    });
  }
  building.sort((a, b) => Number(!!b.needs) - Number(!!a.needs) || ms(b.at) - ms(a.at));

  const shipped = input.items
    .filter((item) => item.status === 'done' && item.kind === 'build' && input.now - ms(item.completedAt) < SHIPPED_WINDOW_MS)
    .sort((a, b) => ms(b.completedAt) - ms(a.completedAt))
    .map((item) => ({ ref: input.refOf(item.number), title: item.title, at: item.completedAt ?? '' }));

  return { waiting, building, shipped };
}

const more = (total: number) => (total > LIST_MAX ? `\n- and ${total - LIST_MAX} more` : '');

/**
 * "Dev now" as the lines of the builder's live layer, most pressing first,
 * so the layer's budget drops the shipped list before what waits on them.
 * An empty section says so, so the builder never fills a gap by guessing.
 * A null brief, when the rows could not be read, is one line saying so.
 */
export function devBriefLines(brief: DevBrief | null, now: Date, timeZone: string): string[] {
  if (!brief) {
    return ['Dev now: the plan could not be read for this reply. Look a step up with read_dev_row when they ask about one, and say plainly if that fails too.'];
  }
  const lines: string[] = ['Dev now, read fresh for this reply:'];
  const when = (at: string) => `${whenDate(at, { timeZone, weekday: 'short', year: 'auto', now })} ${zoneClock(at, timeZone)}`;

  if (brief.waiting.length === 0) lines.push('Waiting on them: nothing.');
  else {
    const rows = brief.waiting.slice(0, LIST_MAX).map((w) => {
      const ask = line(w.ask, QUOTE_MAX);
      return `- ${w.ref ? `${w.ref} ` : ''}${line(w.title, TITLE_MAX)} (${w.why})${ask ? `: ${ask}` : ''}`;
    });
    lines.push(`Waiting on them (${brief.waiting.length}):\n${rows.join('\n')}${more(brief.waiting.length)}`);
  }

  if (brief.building.length === 0) lines.push('Building now: nothing.');
  else {
    const rows = brief.building.slice(0, LIST_MAX).map((b) => {
      const what = b.ref ? `${b.ref} ${line(b.title, TITLE_MAX) ?? ''}`.trim() : 'A session';
      const needs = b.needs ? `; waiting on them for ${line(b.needs, QUOTE_MAX)}` : '';
      return `- ${what}: ${line(b.action, QUOTE_MAX)} (${when(b.at)})${needs}`;
    });
    lines.push(`Building now (${brief.building.length}):\n${rows.join('\n')}${more(brief.building.length)}`);
  }

  if (brief.shipped.length === 0) lines.push('Shipped in the last two days: nothing.');
  else {
    const rows = brief.shipped.slice(0, LIST_MAX).map((s) => `- ${s.ref} ${line(s.title, TITLE_MAX)} (${when(s.at)})`);
    lines.push(`Shipped in the last two days (${brief.shipped.length}):\n${rows.join('\n')}${more(brief.shipped.length)}`);
  }
  return lines;
}

/** Who the builder is told it is, before its own card. */
export const BUILDER_INTRO =
  "You are the Builder. You build this app with the person: Dash's sessions do the work on the plan in Dev, and you keep the person up to date on it in a text thread on People. You know their Dev work from \"Dev now\" below and from the Dev lookups.";

/**
 * The builder's rules after its card: what a catch-up holds, when detail is
 * given, and what "build me X" ends with. The card is the person's to edit;
 * these hold whatever it says.
 */
export const BUILDER_RULES = `HOW YOU KEEP THEM UP TO DATE:
- "What's going on?", "what's up?" or "anything I need to do?" gets at most three short texts: what is waiting on them first, then what is building, then what shipped. Count and name by outline (#2854.5), a few words each. No detail.
- Give detail only when they ask about one thing ("why did #2815 stop?"). Then look it up with read_dev_row, which takes the outline and returns the step, its history and its runs, and answer from what it says. find_dev_text searches the plan, notes and ideas by their words.
- When they say they want something built ("build me X", "I want X", "can we add X"), add it with add_plan_step, everything they said in the detail, and say its outline in one text. A thought with no ask to build it yet is add_idea. To start or restart the build of a step, look it up and use propose_build: it is a proposal they confirm.
- Name every step by its outline, never by an id. Never invent a step, a status or a reason: when "Dev now" and the lookups do not say, say you do not know.`;

/** The builder's heading on its persona layer: who it is, its card, then its rules. */
export function builderHeading(card: string): string {
  return `${BUILDER_INTRO}\n\n${card}\n\n${BUILDER_RULES}`;
}
