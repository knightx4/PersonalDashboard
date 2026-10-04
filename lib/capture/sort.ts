/**
 * Where a typed capture belongs (plan #1580, feature #1579).
 *
 * The one capture box takes anything the person types and files it in one of
 * four places: a todo, an update on one of their goals, a note on a job they
 * are applying for, or a note kept in their vault. One Haiku call reads the
 * sentence with the names of their goals and roles and says which place, which
 * goal or role, and how sure it is (lib/capture/sort-model.ts). This file is
 * the part with no model in it: the places, what the model is shown, and how
 * its reply is checked before the box trusts it.
 *
 * At 0.8 or more the box shows the sort as what will happen; below it, the box
 * offers the places as chips instead of guessing. That is the floor the goals
 * box already uses (JEV_CONFIDENCE_FLOOR in lib/jev/decide.ts).
 *
 * A sentence that plainly says two things, "sent the cover letter to Figma,
 * call Sam on Friday", comes back as two parts, each filed in its own place.
 *
 * No `server-only` guard, so the box can import the labels and the floor.
 */

import type { ModuleId } from '@/lib/modules';

export type CapturePlace = 'todo' | 'goals' | 'jobs' | 'vault';

export const CAPTURE_PLACES: readonly CapturePlace[] = ['todo', 'goals', 'jobs', 'vault'];

/** The workspace each place files into, which decides whether it is offered. */
export const CAPTURE_PLACE_MODULE: Readonly<Record<CapturePlace, ModuleId>> = {
  todo: 'todo',
  goals: 'goals',
  jobs: 'jobs',
  vault: 'vault',
};

/** How the box names each place, on the line under the field and on the chips. */
export const CAPTURE_PLACE_LABELS: Readonly<Record<CapturePlace, string>> = {
  todo: 'Add a todo',
  goals: 'Update a goal',
  jobs: 'Note on a job',
  vault: 'Keep in the vault',
};

/** What the model is told each place is for. */
export const CAPTURE_PLACE_RULES: Readonly<Record<CapturePlace, string>> = {
  todo: 'Something still to be done: a task, an errand, a reminder or a follow-up, even when it concerns a goal or a job.',
  goals:
    'Something that happened or was done that counts towards one of their goals: progress, a result, a number, a person met. Name the goal.',
  jobs: 'News, a fact or a thought about one of the jobs they are applying for: a recruiter, an interview, an application sent, a rejection. Name the role.',
  vault:
    'A thought, idea, quote or piece of information to keep for later, with nothing to do and no goal or job it reports on.',
};

/** At or above this the sort is shown as what will happen; below it the box asks. */
export const CAPTURE_SORT_FLOOR = 0.8;
/** The most places one sentence is split into. */
export const MAX_CAPTURE_PARTS = 3;

export function isCapturePlace(value: unknown): value is CapturePlace {
  return typeof value === 'string' && (CAPTURE_PLACES as readonly string[]).includes(value);
}

/**
 * The places an account can file into: those whose workspace it has. The
 * same rule as availableCaptureActions in lib/capture/actions.ts; undefined
 * modules (not yet known) offers every place.
 */
export function availableCapturePlaces(modules: readonly ModuleId[] | undefined): CapturePlace[] {
  if (!modules) return [...CAPTURE_PLACES];
  return CAPTURE_PLACES.filter((place) => modules.includes(CAPTURE_PLACE_MODULE[place]));
}

export type CaptureSortGoal = { id: string; title: string };
export type CaptureSortRole = { id: string; title: string; company: string | null };

/** What the sorter reads besides the sentence. */
export type CaptureSortContext = {
  /** Only the places this account can file into. An empty list sorts nothing. */
  places: readonly CapturePlace[];
  /** Their open goals. Read only when goals is offered. */
  goals: readonly CaptureSortGoal[];
  /** The roles they are applying for. Read only when jobs is offered. */
  roles: readonly CaptureSortRole[];
};

/** One thing the sentence says, and where it goes. */
export type CapturePart = {
  place: CapturePlace;
  /** The words of the sentence that belong here: the whole sentence when it says one thing. */
  text: string;
  /** Set for goals, when the sort named one of their goals. */
  goal: CaptureSortGoal | null;
  /** Set for jobs, when the sort named one of their roles. */
  role: CaptureSortRole | null;
};

export type CaptureSort = {
  parts: CapturePart[];
  /** 0 to 1; capped under the floor when the reply did not hold together. */
  confidence: number;
  /** confidence >= CAPTURE_SORT_FLOOR: the box files without asking. */
  sure: boolean;
};

/** A role as the person would name it: "Product Analyst at Stripe". */
export function roleName(role: CaptureSortRole): string {
  return role.company ? `${role.title} at ${role.company}` : role.title;
}

/**
 * The refs the model names goals and roles by. Short and positional, so no
 * id reaches the model and an invented ref is easy to refuse.
 */
function goalRef(index: number): string {
  return `g${index + 1}`;
}
function roleRef(index: number): string {
  return `r${index + 1}`;
}

/** The message the model reads: the places offered, the goals and roles by ref, then the sentence. */
export function captureSortMessage(sentence: string, context: CaptureSortContext): string {
  const lines: string[] = ['Places you may use:'];
  for (const place of context.places) lines.push(`- ${place}: ${CAPTURE_PLACE_RULES[place]}`);
  if (context.places.includes('goals')) {
    lines.push('', 'Their goals:');
    if (context.goals.length === 0) lines.push('(none)');
    context.goals.forEach((goal, i) => lines.push(`${goalRef(i)} ${goal.title}`));
  }
  if (context.places.includes('jobs')) {
    lines.push('', 'The jobs they are applying for:');
    if (context.roles.length === 0) lines.push('(none)');
    context.roles.forEach((role, i) => lines.push(`${roleRef(i)} ${roleName(role)}`));
  }
  lines.push('', 'What they typed:', sentence.trim());
  return lines.join('\n');
}

/** Under the floor, for a reply that named a place but not what in it. */
const UNSURE = 0.5;

function clamp(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The model's reply, checked against what it was shown. A place not offered
 * is dropped. A goals part with no known goal, or a jobs part with no known
 * role, is kept with its place but pulls the confidence under the floor, so
 * the box asks rather than filing against a guess. A reply with nothing usable
 * is a sort with no parts and no confidence.
 */
export function readCaptureSortReply(
  input: unknown,
  sentence: string,
  context: CaptureSortContext,
): CaptureSort {
  const reply = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const rawParts = Array.isArray(reply.parts) ? reply.parts : [];
  let confidence = clamp(reply.confidence);
  const whole = sentence.trim();

  const parts: CapturePart[] = [];
  for (const raw of rawParts.slice(0, MAX_CAPTURE_PARTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as Record<string, unknown>;
    if (!isCapturePlace(part.place) || !context.places.includes(part.place)) continue;
    const text = typeof part.text === 'string' && part.text.trim() ? part.text.trim() : whole;

    let goal: CaptureSortGoal | null = null;
    let role: CaptureSortRole | null = null;
    if (part.place === 'goals') {
      goal = context.goals.find((_, i) => goalRef(i) === part.goal_ref) ?? null;
      if (!goal) confidence = Math.min(confidence, UNSURE);
    } else if (part.place === 'jobs') {
      role = context.roles.find((_, i) => roleRef(i) === part.role_ref) ?? null;
      if (!role) confidence = Math.min(confidence, UNSURE);
    }
    parts.push({ place: part.place, text: rawParts.length === 1 ? whole : text, goal, role });
  }

  if (parts.length === 0) return { parts: [], confidence: 0, sure: false };
  return { parts, confidence, sure: confidence >= CAPTURE_SORT_FLOOR };
}
