import type { JevChoiceAnswer, JevResult } from '@/lib/jev/wire';
import { MODULES, isModuleId, type ModuleId } from '@/lib/modules';

/**
 * Triage for a note or an idea at the moment it is filed (plan #1179).
 *
 * Five questions go to Jev in one request about the text just filed: bug or
 * request, which workspace, how soon, whether it is a fix or something to
 * plan (plan #1674), and whether an open note or idea already says the same
 * thing. The answers are stored on the row as
 * `triage` (migration 0121) and shown in the header panel under "saved",
 * so the note arrives sorted instead of waiting for the notes routine.
 *
 * An answer under 0.8 is kept with its confidence and shown as unsure. No
 * Haiku call stands behind it: Haiku would read the same two sentences, and
 * the notes routine that works the queue reads every note again anyway
 * (the same choice #1178 made for job openings). A likely duplicate is named
 * beside the note, never merged into it.
 *
 * Pure and without a `server-only` guard, so the panel can import the labels
 * and a script can run the questions under plain `tsx`.
 */

export type TriageKind = 'bug' | 'feature';
/** Whether a note is one change a session can finish, or work to plan first. */
export type TriageRoute = 'fix' | 'plan';
export type TriagePriority = 1 | 2 | 3;
/** A workspace, or `app` for the app as a whole. */
export type TriageModule = ModuleId | 'app';
export type TriageTable = 'feedback_items' | 'ideas';

/** An open note or idea a new one is compared against. */
export type TriageCandidate = { table: TriageTable; id: string; body: string };

/** The open item a new one reads as a rewrite of, as it is stored and shown. */
export type TriageMatch = { table: TriageTable; id: string; line: string };

/** One answer and how sure Jev was of it. */
export type TriageAnswer<T> = { value: T; confidence: number };

/**
 * What is stored in `triage`. A field is null when Jev gave no usable answer
 * to that question; one under the floor is kept, with its confidence, and
 * read as unsure.
 */
export type Triage = {
  at: string;
  kind: TriageAnswer<TriageKind> | null;
  module: TriageAnswer<TriageModule> | null;
  priority: TriageAnswer<TriagePriority> | null;
  /**
   * Fix or plan (plan #1674). Absent on a row triaged before the question
   * existed, null when Jev gave no usable answer.
   */
  route?: TriageAnswer<TriageRoute> | null;
  /** `value: null` is Jev saying none of the open items is the same. */
  duplicate: TriageAnswer<TriageMatch | null> | null;
};

/** At or above this an answer is shown as settled (lib/jev/decide.ts). */
export const TRIAGE_FLOOR = 0.8;
/** The panel stops waiting past this; the note is already saved. */
export const TRIAGE_TIMEOUT_MS = 2_000;
/**
 * The most open items one note is compared against, newest first. Each is an
 * option in the duplicate question and Jev takes at most 255; the 128 open
 * today fit with room.
 */
export const TRIAGE_MAX_CANDIDATES = 200;
/** How much of each open item's first line the duplicate question shows. */
const CANDIDATE_LINE_MAX = 140;

export const TRIAGE_KIND_OPTIONS: Readonly<Record<TriageKind, string>> = {
  bug: 'Something in the app is broken or wrong: an error, a crash, a missing or wrong value, or a screen that does not do what it already claims to.',
  feature:
    'A change or an addition: something new the app should do, or something that works as built but should work differently.',
};

export const TRIAGE_PRIORITY_OPTIONS = {
  next: 'Do it next: something used every day is broken or blocked, or data is being lost or shown wrongly.',
  normal: 'Normal: worth doing soon, but nothing stops working without it.',
  someday: 'Someday: a nice-to-have, a polish, or a thought for later.',
} as const;

const PRIORITY_OF: Record<keyof typeof TRIAGE_PRIORITY_OPTIONS, TriagePriority> = {
  next: 1,
  normal: 2,
  someday: 3,
};

export const TRIAGE_ROUTE_OPTIONS: Readonly<Record<TriageRoute, string>> = {
  fix: 'A fix: one change in one place that a session can finish and verify in a sitting.',
  plan: 'A plan: it needs a new screen, a migration, work across workspaces, or a choice of the person\'s before it can be built.',
};

/** Each workspace in its own words, and the app as a whole. */
export const TRIAGE_MODULE_OPTIONS: Readonly<Record<TriageModule, string>> = {
  ...(Object.fromEntries(
    MODULES.map((module) => [module.id, `${module.label}: ${module.description}.`]),
  ) as Record<ModuleId, string>),
  app: 'The app as a whole or several workspaces at once: the header, navigation, search, Dash, sign-in, the home page, or settings.',
};

export const TRIAGE_KIND_QUESTION = {
  type: 'choice',
  question: 'Is this note about the app a bug report or a request for a change?',
  options: TRIAGE_KIND_OPTIONS,
} as const;

export const TRIAGE_MODULE_QUESTION = {
  type: 'choice',
  question:
    'Which part of the app is this note about? The page it was written on is a clue, not the answer.',
  options: TRIAGE_MODULE_OPTIONS,
} as const;

export const TRIAGE_PRIORITY_QUESTION = {
  type: 'choice',
  question: 'How soon should this note about the app be worked on?',
  options: TRIAGE_PRIORITY_OPTIONS,
} as const;

export const TRIAGE_ROUTE_QUESTION = {
  type: 'choice',
  question:
    'Is this note about the app one fix a session can finish in a sitting, or work that needs planning first?',
  options: TRIAGE_ROUTE_OPTIONS,
} as const;

/** The label Jev answers with when no open item matches. */
export const NO_MATCH = 'none';

/** The first line of a note or idea, which is how one is named. */
export function triageLine(body: string, max = CANDIDATE_LINE_MAX): string {
  const line = body.split('\n')[0].trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The duplicate question over the open items, and the key each option was
 * given. Keys are short and carry no id, so nothing but the text reaches
 * TypeSafe.
 */
export function duplicateQuestion(candidates: readonly TriageCandidate[]): {
  question: {
    type: 'choice';
    question: string;
    options: Record<string, string>;
  };
  keys: Map<string, TriageCandidate>;
} {
  const keys = new Map<string, TriageCandidate>();
  const options: Record<string, string> = {
    [NO_MATCH]: 'None of these: the new note asks for something that is not already listed.',
  };
  candidates.slice(0, TRIAGE_MAX_CANDIDATES).forEach((candidate, index) => {
    const key = `item${index + 1}`;
    keys.set(key, candidate);
    options[key] = triageLine(candidate.body);
  });
  return {
    question: {
      type: 'choice',
      question:
        'Which of these open notes and ideas already asks for the same thing as the new note, ' +
        'in the same or other words? Answer none unless one would be closed by the same change.',
      options,
    },
    keys,
  };
}

/** What Jev reads: the new text, what it was filed as, and where. */
/**
 * What the note was filed as, in Jev's words. A `note` is one from the header's
 * single Bug or feature tab (note 55b53dc9): the person did not say which, so
 * Jev is not told one and the kind question is answered from the text alone.
 */
const FILED_AS: Record<TriageKind | 'idea' | 'note', string> = {
  idea: 'an idea',
  bug: 'a bug',
  feature: 'a request',
  note: 'a note; the person did not say whether it is a bug or a request',
};

export function triageState(input: {
  body: string;
  filedAs: TriageKind | 'idea' | 'note';
  pagePath: string | null;
}): Record<string, unknown> {
  return {
    new_note: input.body.trim(),
    filed_as: FILED_AS[input.filedAs],
    ...(input.pagePath ? { written_on_page: input.pagePath } : {}),
  };
}

type ChoiceResult = JevResult<JevChoiceAnswer> | undefined;

function answered(result: ChoiceResult): JevChoiceAnswer | null {
  return result && result.ok ? result.answer : null;
}

/** Jev's four answers, read into what is stored. Any it could not give is null. */
export function readTriage(
  answers: {
    kind?: ChoiceResult;
    module?: ChoiceResult;
    priority?: ChoiceResult;
    route?: ChoiceResult;
    duplicate?: ChoiceResult;
  },
  keys: ReadonlyMap<string, TriageCandidate>,
  at: Date = new Date(),
): Triage {
  const kind = answered(answers.kind);
  const scope = answered(answers.module);
  const priority = answered(answers.priority);
  const route = answered(answers.route);
  const duplicate = answered(answers.duplicate);

  let match: TriageAnswer<TriageMatch | null> | null = null;
  if (duplicate) {
    if (duplicate.choice === NO_MATCH) match = { value: null, confidence: duplicate.confidence };
    else {
      const candidate = keys.get(duplicate.choice);
      if (candidate) {
        match = {
          value: { table: candidate.table, id: candidate.id, line: triageLine(candidate.body, 90) },
          confidence: duplicate.confidence,
        };
      }
    }
  }

  return {
    at: at.toISOString(),
    kind:
      kind && (kind.choice === 'bug' || kind.choice === 'feature')
        ? { value: kind.choice, confidence: kind.confidence }
        : null,
    module:
      scope && (scope.choice === 'app' || isModuleId(scope.choice))
        ? { value: scope.choice as TriageModule, confidence: scope.confidence }
        : null,
    priority:
      priority && priority.choice in PRIORITY_OF
        ? {
            value: PRIORITY_OF[priority.choice as keyof typeof PRIORITY_OF],
            confidence: priority.confidence,
          }
        : null,
    route:
      route && (route.choice === 'fix' || route.choice === 'plan')
        ? { value: route.choice, confidence: route.confidence }
        : null,
    duplicate: match,
  };
}

export function isSure(answer: TriageAnswer<unknown> | null): boolean {
  return answer !== null && answer.confidence >= TRIAGE_FLOOR;
}

/** A stored `triage` value read back, or null when it is missing or not this shape. */
export function triageFrom(value: unknown): Triage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.at !== 'string') return null;
  const answer = <T>(field: unknown, valid: (v: unknown) => boolean): TriageAnswer<T> | null => {
    if (!field || typeof field !== 'object') return null;
    const { value: v, confidence } = field as Record<string, unknown>;
    if (typeof confidence !== 'number' || !valid(v)) return null;
    return { value: v as T, confidence };
  };
  return {
    at: raw.at,
    kind: answer<TriageKind>(raw.kind, (v) => v === 'bug' || v === 'feature'),
    module: answer<TriageModule>(
      raw.module,
      (v) => typeof v === 'string' && (v === 'app' || isModuleId(v)),
    ),
    priority: answer<TriagePriority>(raw.priority, (v) => v === 1 || v === 2 || v === 3),
    route: answer<TriageRoute>(raw.route, (v) => v === 'fix' || v === 'plan'),
    duplicate: answer<TriageMatch | null>(
      raw.duplicate,
      (v) =>
        v === null ||
        (typeof v === 'object' &&
          typeof (v as TriageMatch).id === 'string' &&
          typeof (v as TriageMatch).line === 'string' &&
          ((v as TriageMatch).table === 'feedback_items' || (v as TriageMatch).table === 'ideas')),
    ),
  };
}

const KIND_LABEL: Record<TriageKind, string> = { bug: 'Bug', feature: 'Request' };
const ROUTE_LABEL: Record<TriageRoute, string> = { fix: 'Fix', plan: 'Plan' };
const PRIORITY_LABEL: Record<TriagePriority, string> = { 1: 'Next', 2: 'Normal', 3: 'Someday' };

function moduleLabel(value: TriageModule): string {
  if (value === 'app') return 'Whole app';
  return MODULES.find((module) => module.id === value)?.label ?? value;
}

/** One stored triage as the person reads it. */
export type TriageView = {
  /** Type, workspace, priority and fix or plan, each with "?" when unsure. */
  parts: string[];
  /** The open item it reads as a rewrite of, when Jev is sure of it. */
  match: TriageMatch | null;
  /** Jev thinks there may be a match but is not sure. */
  maybeMatch: TriageMatch | null;
};

export function triageView(triage: Triage | null): TriageView | null {
  if (!triage) return null;
  const parts: string[] = [];
  const part = <T>(answer: TriageAnswer<T> | null, label: (value: T) => string, prefix = '') => {
    if (!answer) return;
    parts.push(`${prefix}${label(answer.value)}${isSure(answer) ? '' : '?'}`);
  };
  part(triage.kind, (v) => KIND_LABEL[v]);
  part(triage.module, moduleLabel);
  part(triage.priority, (v) => PRIORITY_LABEL[v], 'Priority: ');
  part(triage.route ?? null, (v) => ROUTE_LABEL[v]);
  const dup = triage.duplicate?.value ?? null;
  const sure = isSure(triage.duplicate);
  if (parts.length === 0 && !dup) return null;
  return { parts, match: sure ? dup : null, maybeMatch: sure ? null : dup };
}

/** Where the matched item lives, for a link from the panel or a row. */
export function matchHref(match: TriageMatch): string {
  return match.table === 'ideas' ? `/dev/ideas#idea-${match.id}` : `/dev/bugs#note-${match.id}`;
}
