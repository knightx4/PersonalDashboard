import { z } from 'zod';

/**
 * Explaining an idea back and having it marked (plan #1054).
 *
 * Every so often the deck gives you an idea you kept at least three days ago
 * and asks you to explain it as if to a friend. What you write is marked
 * against the idea's claim and basis for what was right, what was missing and
 * whether you gave an example of your own; Dash then asks one follow-up
 * question and marks that too.
 *
 * #1055 settled that this is the defence rung: an explanation that holds and
 * survives the follow-up marks the idea sharp. This file holds the rules that
 * need no database or model, so they are tested directly: when a teach-back
 * is due, which idea it asks about, where the answers leave the idea, and
 * what the thread says.
 */

/** One card in this many is a teach-back, until the person changes it. */
export const TEACH_BACK_DEFAULT_EVERY = 10;

/** The choices offered for the rate. 0 turns teach-backs off. */
export const TEACH_BACK_RATES = [5, 10, 20, 40, 0] as const;

export function isTeachBackRate(value: unknown): value is (typeof TEACH_BACK_RATES)[number] {
  return TEACH_BACK_RATES.includes(value as (typeof TEACH_BACK_RATES)[number]);
}

/** How the rate reads in the setting's menu. */
export function teachBackRateLabel(every: number): string {
  return every === 0 ? 'Never' : `One card in ${every}`;
}

/** An idea is asked about only once it has been kept this long. */
export const KEPT_DAYS = 3;

/** An idea asked about is not asked about again for this long. */
export const REPEAT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the deck is owed a teach-back: the rate is on, none is waiting to
 * be answered, and enough other cards have been written since the last one
 * that this one makes it one in `every`.
 */
export function teachBackDue(input: { every: number; writtenSince: number; waiting: boolean }): boolean {
  if (input.every <= 0 || input.waiting) return false;
  return input.writtenSince >= input.every - 1;
}

/** A card whose idea could be asked about: what the person did with it, and when. */
export type KeptIdea = { conceptId: string; actedAt: string };

/**
 * The idea to ask about, from the ideas kept, oldest first.
 *
 * Kept means swiped known or "work on this", or saved: something the person
 * chose to hold on to rather than an idea they only scrolled past. It has to
 * be at least `KEPT_DAYS` old, not asked about in the last `REPEAT_DAYS`, and
 * not already sharp, since a teach-back cannot move a sharp idea any higher.
 * The one kept longest ago comes first, being the one most likely to have
 * slipped.
 */
export function pickTeachBackIdea(
  kept: readonly KeptIdea[],
  exclude: { askedRecently: ReadonlySet<string>; sharp: ReadonlySet<string> },
  now: number,
): KeptIdea | null {
  const cutoff = now - KEPT_DAYS * DAY_MS;
  const sorted = [...kept].sort((a, b) => a.actedAt.localeCompare(b.actedAt));
  return (
    sorted.find(
      (idea) =>
        Date.parse(idea.actedAt) <= cutoff &&
        !exclude.askedRecently.has(idea.conceptId) &&
        !exclude.sharp.has(idea.conceptId),
    ) ?? null
  );
}

/** When an idea asked about in the last `REPEAT_DAYS` was asked from. */
export function repeatCutoff(now: number): string {
  return new Date(now - REPEAT_DAYS * DAY_MS).toISOString();
}

/** When an idea has to have been kept by to be asked about. */
export function keptCutoff(now: number): string {
  return new Date(now - KEPT_DAYS * DAY_MS).toISOString();
}

/** The question on the card. */
export function teachBackPrompt(name: string): string {
  return `Explain ${name.trim()} to a friend in a few sentences: what it is, why it holds, and an example of your own.`;
}

/** The line above the title: when the idea was kept. */
export function teachBackWhy(keptAt: string): string {
  const day = new Date(keptAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `You kept this idea on ${day}.`;
}

/** The paragraph under the title. */
export const TEACH_BACK_CONTEXT =
  'Write it from memory, in your own words. Dash marks what you got right and what you left out, then asks one follow-up.';

/** What the marker found in one answer. */
export type Marking = {
  /** Whether the answer gets the idea right in substance. */
  holds: boolean;
  /** The points it got right, short. */
  right: string[];
  /** The points it left out or got wrong, short. */
  missing: string[];
  /** The marker's one sentence on the answer. */
  why: string;
};

/** The first answer's marking, which also says whether it had an example of its own. */
export type ExplanationMarking = Marking & { ownExample: boolean };

/** What an answer can leave the idea at. */
export type TeachBackState = 'shaky' | 'known' | 'sharp';

/**
 * Where the answers leave the idea.
 *
 * An explanation that does not hold leaves it shaky, whatever the follow-up
 * does: a miss is a miss, the same rule as every other rung. One that holds
 * shows the idea is known, which is recorded straight away so walking off
 * before the follow-up still counts for something. Surviving the follow-up is
 * holding a defence, which is what sharp means (#1055); failing it leaves the
 * idea known.
 */
export function teachBackState(explained: boolean, followedUp: boolean | null): TeachBackState {
  if (!explained) return 'shaky';
  return followedUp === true ? 'sharp' : 'known';
}

const STATE_WORDS: Record<TeachBackState, string> = {
  shaky: 'shaky: worth another look',
  known: 'known',
  sharp: 'sharp',
};

/** The line saying what the idea is now marked, for the thread and the card. */
export function stateLine(name: string, state: TeachBackState): string {
  return `${name.trim()} is now marked ${STATE_WORDS[state]}.`;
}

function listed(label: string, points: readonly string[]): string[] {
  const kept = points.map((point) => point.trim()).filter(Boolean);
  if (kept.length === 0) return [];
  return [`${label}`, ...kept.map((point) => `- ${point}`), ''];
}

/**
 * Dash's reply to the explanation, as the thread keeps it: what was right,
 * what was missing, the example, and the follow-up question.
 */
export function explanationReply(marking: ExplanationMarking, followUp: string): string {
  const lines = [
    ...listed('What you got right:', marking.right),
    ...listed('What was missing:', marking.missing),
    marking.ownExample ? 'You gave an example of your own.' : 'You did not give an example of your own.',
    '',
    `One follow-up: ${followUp.trim()}`,
  ];
  if (marking.right.length === 0 && marking.missing.length === 0) lines.unshift(marking.why, '');
  return lines.join('\n');
}

/** Dash's reply to the follow-up answer, ending on where it leaves the idea. */
export function followUpReply(marking: Marking, name: string, state: TeachBackState): string {
  const lines = [
    ...listed('What you got right:', marking.right),
    ...listed('What was missing:', marking.missing),
  ];
  if (lines.length === 0) lines.push(marking.why, '');
  lines.push(stateLine(name, state));
  return lines.join('\n');
}

const markingSchema = z.object({
  holds: z.boolean(),
  right: z.array(z.string()),
  missing: z.array(z.string()),
  why: z.string(),
});

const recordSchema = z.object({
  stage: z.enum(['follow_up', 'done']),
  /** What they wrote first, which the follow-up is marked alongside. */
  explanation: z.string().min(1),
  explained:markingSchema.extend({ ownExample: z.boolean() }),
  followUp: z.string().min(1),
  followUpExpected: z.string().min(1),
  answered: markingSchema.optional(),
  state: z.enum(['shaky', 'known', 'sharp']),
});

/** What `feed_cards.teach_back` holds once the explanation is marked. */
export type TeachBackRecord = z.infer<typeof recordSchema>;

/** The stored exchange, or null for a card not answered yet or a value it cannot read. */
export function parseTeachBack(raw: unknown): TeachBackRecord | null {
  if (raw === null || raw === undefined) return null;
  const parsed = recordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Where a teach-back card has got to, as the page shows it. Never the expected answer. */
export type TeachBackView = {
  conceptId: string;
  stage: 'explain' | 'follow_up' | 'done';
  /** What the idea was left at, once anything is marked. */
  state: TeachBackState | null;
  /** The idea's claim, shown once the exchange is over. */
  claim: string | null;
};

export function teachBackView(conceptId: string, claim: string | null, raw: unknown): TeachBackView {
  const record = parseTeachBack(raw);
  if (!record) return { conceptId, stage: 'explain', state: null, claim: null };
  return {
    conceptId,
    stage: record.stage,
    state: record.state,
    claim: record.stage === 'done' ? claim : null,
  };
}
