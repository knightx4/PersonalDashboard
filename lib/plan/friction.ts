/**
 * What building this app keeps running into (migration 0303).
 *
 * A friction row is one thing that cost a builder time. A lesson is the cause
 * behind a group of them, under a short key, so that the fifth session to hit
 * a wall adds a count to a row instead of writing a fifth stop line nobody
 * reads beside the other four. The daily review (.claude/skills/builder-loop)
 * ranks the lessons, removes the costliest cause in code, and writes what a
 * builder should do for the causes code cannot remove. Every builder is shown
 * those lessons when it claims a step.
 *
 * This file is pure: the keys the tools file their own refusals under, the
 * ranking, and the lines a builder reads. lib/plan/friction-store.ts writes.
 */

export const FRICTION_KINDS = [
  'guard', // a tool refused: plan.ts done, land or built, ui-guard
  'gate', // a check in npm run gate failed
  'tool', // a script, shooter, connector or build broke
  'mistake', // the builder did something wrong it then had to undo
  'misled', // a doc, message or stop line pointed the wrong way
  'slow', // something took far longer than it should
  'stop', // a run ended without closing its step (from plan_runs)
  'critic', // the design critic asked for the same kind of fix again
  'writing', // the writing check flagged plan text
] as const;
export type FrictionKind = (typeof FRICTION_KINDS)[number];

export const LESSON_STATUSES = ['open', 'taught', 'fixed', 'wont_fix'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const WHAT_MAX = 600;
export const LESSON_MAX = 1200;

export function isFrictionKind(value: string | null | undefined): value is FrictionKind {
  return (FRICTION_KINDS as readonly string[]).includes(value ?? '');
}

/** A lesson key from free text: lower case, words joined by hyphens, at most 80 characters. */
export function lessonKey(text: string): string {
  const key = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return key.length >= 2 ? key : `x-${key || 'unnamed'}`;
}

export function isLessonKey(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,79}$/.test(value);
}

/** Text cut to fit a column, on one line. */
export function clip(text: string, max = WHAT_MAX): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/**
 * The lesson a refusal or stop line belongs to, when it is one the tools know
 * by its words; null leaves it for the review to file. The patterns are the
 * walls seen most in the run history up to 5 November 2026.
 */
const KNOWN: { key: string; title: string; test: RegExp }[] = [
  {
    key: 'built-records-another-steps-commit',
    title: "A step marked built carried another step's commit",
    test: /names #[0-9.]+(, #[0-9.]+)* and not #|names another step/,
  },
  {
    key: 'close-refused-by-critic-gate',
    title: 'A step whose code is on main cannot close until the design critic passes its surfaces',
    test: /design critic (has not passed|has (recorded )?no round|has no recorded)|critic has no round|critic passes|no critic rounds?|ui-guard.*(refus|cannot close)|cannot close.*critic/i,
  },
  {
    key: 'shooter-or-preview-build-failed',
    title: 'The preview build or the screenshot shooter failed in a cloud session',
    test: /fetch failed|shooters? (died|failed)|preview build.*failed|compare (failed|timed out)|port \d+ (is )?held/i,
  },
  {
    key: 'close-refused-commit-not-on-main',
    title: "A step's recorded commit is not on main",
    test: /not on (origin\/)?main|commit .* has not landed/i,
  },
  {
    key: 'claim-expired-mid-build',
    title: 'A claim expired while the step was still being built',
    test: /claims? (had )?expired/i,
  },
  {
    key: 'step-too-big-for-one-sitting',
    title: 'A step was too big for one sitting',
    test: /more than one sitting|too big|split into/i,
  },
  {
    key: 'connector-call-timed-out',
    title: 'A connector call waited for a confirmation that never came',
    test: /connector.*(timed out|waited)|needs your input/i,
  },
  {
    key: 'migration-not-applied',
    title: 'Code on main read a column or table whose migration was not applied',
    test: /migration .*(not|never) applied|column .* does not exist|relation .* does not exist/i,
  },
];

export function knownLesson(text: string): { key: string; title: string } | null {
  for (const known of KNOWN) if (known.test.test(text)) return { key: known.key, title: known.title };
  return null;
}

/**
 * The lesson a failed gate check is filed under. Lint failures are filed by
 * rule, so a rule broken every week shows as one row with a count; other
 * lanes by step name.
 */
export function gateLesson(step: string, log: string): { key: string; title: string } {
  if (/^lint$/i.test(step)) {
    const rules = [...log.matchAll(/\s(?:error|warning)\s+.*?\s{2,}([@a-z0-9/-]+)\s*$/gim)].map((m) => m[1]);
    const rule = rules[0];
    if (rule) return { key: lessonKey(`gate-lint-${rule}`), title: `Lint keeps failing on ${rule}` };
  }
  if (/spec counts/i.test(step)) {
    const counter = /([a-z][\w-]+) rose from/i.exec(log)?.[1] ?? /count (\S+) rose/i.exec(log)?.[1];
    if (counter) return { key: lessonKey(`gate-spec-${counter}`), title: `The spec count ${counter} rose` };
  }
  if (/ui laws/i.test(step)) {
    const law = /\b(R\d+|law[ -]\w+)\b/i.exec(log)?.[1];
    if (law) return { key: lessonKey(`gate-ui-${law}`), title: `The UI law ${law} failed in the gate` };
  }
  return { key: lessonKey(`gate-${step}`), title: `The gate's ${step} check failed` };
}

/** The lesson a design critic fix is filed under: the law or check it breaks. */
export function criticLesson(breaks: string): { key: string; title: string } {
  return { key: lessonKey(`critic-${breaks}`), title: `The design critic keeps asking for fixes under "${breaks}"` };
}

/** The lesson a writing-check flag is filed under. */
export function writingLesson(label: string): { key: string; title: string } {
  return { key: lessonKey(`writing-${label}`), title: `Plan text keeps tripping the writing check: ${label}` };
}

/** A lesson as the ranking reads it. */
export type LessonRow = {
  id: string;
  key: string;
  title: string;
  lesson: string | null;
  status: LessonStatus;
  fix: string | null;
  fixed_at: string | Date | null;
  regressed_at: string | Date | null;
};

/** A friction row as the ranking reads it. */
export type FrictionRow = {
  lesson_id: string | null;
  kind: string;
  cost_minutes: number | null;
  created_at: string | Date;
};

export type RankedLesson = LessonRow & {
  /** Friction in the window. */
  count: number;
  /** Friction in the window after the lesson was fixed: a regression when above zero. */
  sinceFix: number;
  /** Minutes the window's friction cost, with an unknown cost counted as DEFAULT_COST. */
  minutes: number;
  /** Count in the window before this one, to say whether it is growing. */
  before: number;
};

/** What a friction row with no cost is taken to have cost, in minutes. */
export const DEFAULT_COST = 15;

const DAY = 24 * 60 * 60 * 1000;

function time(value: string | Date | null): number | null {
  if (value === null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * The lessons in order of what they cost over the last `days` days: the
 * minutes, then the count. A lesson that was fixed and has friction since is
 * a regression and goes first, whatever it cost. Wont-fix lessons are left
 * out.
 */
export function rankLessons(
  lessons: readonly LessonRow[],
  friction: readonly FrictionRow[],
  now: number,
  days = 14,
): RankedLesson[] {
  const from = now - days * DAY;
  const beforeFrom = from - days * DAY;
  const ranked = lessons
    .filter((l) => l.status !== 'wont_fix')
    .map((lesson) => {
      const fixedAt = time(lesson.fixed_at);
      let count = 0;
      let sinceFix = 0;
      let minutes = 0;
      let before = 0;
      for (const row of friction) {
        if (row.lesson_id !== lesson.id) continue;
        const at = time(row.created_at) ?? 0;
        if (at >= from) {
          count += 1;
          minutes += row.cost_minutes ?? DEFAULT_COST;
          if (fixedAt !== null && at > fixedAt) sinceFix += 1;
        } else if (at >= beforeFrom) before += 1;
      }
      return { ...lesson, count, sinceFix, minutes, before };
    });
  return ranked.sort(
    (a, b) =>
      Number(b.sinceFix > 0) - Number(a.sinceFix > 0) ||
      b.minutes - a.minutes ||
      b.count - a.count ||
      a.key.localeCompare(b.key),
  );
}

/**
 * The lessons a builder is shown when it claims a step: every taught or open
 * lesson with words written for builders, and any regression, costliest
 * first. A fixed lesson is not shown, since the code now stops the mistake.
 */
export function briefLessons(ranked: readonly RankedLesson[], limit = 8): string[] {
  return ranked
    .filter((l) => (l.status !== 'fixed' && l.lesson) || l.sinceFix > 0)
    .slice(0, limit)
    .map((l) => {
      const seen = l.count > 0 ? ` (hit ${l.count}× in 14 days)` : '';
      const regressed = l.sinceFix > 0 ? ' REGRESSED since its fix.' : '';
      return `- ${l.title}${seen}.${regressed} ${l.lesson ?? ''}`.trim();
    });
}

/** The heading and lines printed under a claimed step, or nothing when there are none. */
export function lessonsBlock(lines: readonly string[]): string {
  if (lines.length === 0) return '';
  return [
    '',
    'Before you build: what other builders kept running into (npm run friction -- lessons).',
    ...lines,
    'Hit one of these, or anything else that costs you time? npm run friction -- log "<what happened>" --kind <kind>.',
  ].join('\n');
}
