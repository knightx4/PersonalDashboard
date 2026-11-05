import { BUILDER_KEY } from '@/lib/you/builder-model';
import { isQuietHours } from '@/lib/you/council-texts';

/**
 * A person on People texting first when something happens (plan #2854.1).
 *
 * Things worth a text are written down as they happen, one row each in
 * you.first_text_events (you 0042): a plan step that starts waiting on the
 * person, a question put to them, a build that shipped, a run that failed or
 * stalled. Triggers on the plan's own tables write them, so nothing has to
 * remember to.
 *
 * Each person who texts first has a rule: the kinds of event they text
 * about, how many texts a day they send, and how they word a batch. Every
 * five minutes the council-texts sweep (inngest/you/first-texts.ts) hands
 * each rule the events waiting for it, and `decideFirstText` says whether to
 * text now, what to say, and whether it is worth a notification:
 *
 *   - Batched. Nothing is sent until the newest event is SETTLE_MS old, so a
 *     burst of changes becomes one text; a stream that never pauses is sent
 *     once its oldest event is BATCH_MAX_MS old.
 *   - Quiet overnight. From 22:00 to 08:00 in the person's zone the events
 *     wait, and the morning's first pass sends them as one text.
 *   - A small daily limit. A rule sends at most `dailyLimit` texts on a UTC
 *     day; past it the events wait for tomorrow.
 *   - Every text comes with a notification. A text first is one the person
 *     did not ask for, so it reaches the phone whatever it is about (note
 *     6a69a1c3); it used to push only a batch holding something to do today,
 *     and a build shipped or failed sat unseen in the thread.
 *   - Theirs to change. What counts as worth a text is a list of switches on
 *     the person's form (board_advisors.text_when, null for the rule's
 *     defaults). An event of a kind switched off is closed unsent.
 *
 * Events older than STALE_MS are closed unsent: a day-old "this shipped" is
 * noise. Pure, so the tests fix the clock.
 */

export const TEXT_KINDS = ['needs_you', 'question', 'shipped', 'failed'] as const;
export type TextKind = (typeof TEXT_KINDS)[number];

export function isTextKind(value: unknown): value is TextKind {
  return typeof value === 'string' && (TEXT_KINDS as readonly string[]).includes(value);
}

/** Each kind as the person's form lists it. Every one is texted with a notification. */
export const TEXT_KIND_INFO: Record<TextKind, { label: string; hint: string }> = {
  needs_you: { label: 'A step needs you', hint: 'Something to set up, or a build stuck until you act.' },
  question: { label: 'A question is waiting for your answer', hint: 'A decision on the plan, or a run asking you.' },
  shipped: { label: 'A build shipped', hint: 'What reached main.' },
  failed: { label: 'A build failed or stalled', hint: 'A run that stopped before it finished.' },
};

/** No text until the newest event has been quiet this long, so a burst becomes one text. */
export const SETTLE_MS = 5 * 60 * 1000;
/** A stream of events that never pauses is sent once its oldest is this old. */
export const BATCH_MAX_MS = 30 * 60 * 1000;
/** An event not texted by this age is closed unsent. */
export const STALE_MS = 36 * 60 * 60 * 1000;
/** The longest title a text quotes. */
export const TITLE_QUOTED = 80;

/** One event, as the sweep hands it to a rule: the row and the step it names, already named. */
export type TextEvent = {
  id: string;
  kind: TextKind;
  createdAt: string;
  /** `#2854.3`, or null when the event names no step. */
  ref: string | null;
  title: string | null;
  /** For a failed run: whether it failed or went stale. */
  detail: 'failed' | 'stalled' | null;
};

export type FirstTextRule = {
  /** The person's key in you.board_advisors: whoever has it texts by this rule. */
  key: string;
  /** The kinds they text about, in the order their form lists them. */
  kinds: readonly TextKind[];
  /** Switched on until the person changes it. */
  defaults: readonly TextKind[];
  dailyLimit: number;
  /** A batch as bubbles, one to three, in their voice. */
  write(events: readonly TextEvent[]): string[];
};

/** The kinds a person texts about: their own list when they have one, kept to the rule's kinds, else the rule's defaults. */
export function enabledKinds(rule: FirstTextRule, stored: readonly string[] | null | undefined): TextKind[] {
  if (!stored) return [...rule.defaults];
  return rule.kinds.filter((kind) => stored.includes(kind));
}

/** What the person's form shows: each of the rule's kinds, and whether it is on. */
export type TextSwitch = { kind: TextKind; label: string; hint: string; on: boolean };

export function textSwitches(rule: FirstTextRule, stored: readonly string[] | null | undefined): TextSwitch[] {
  const on = new Set(enabledKinds(rule, stored));
  return rule.kinds.map((kind) => ({ kind, label: TEXT_KIND_INFO[kind].label, hint: TEXT_KIND_INFO[kind].hint, on: on.has(kind) }));
}

/** The list as it is saved: known kinds the rule has, in its order; null when it matches the defaults. */
export function storedTextWhen(rule: FirstTextRule, on: readonly string[]): TextKind[] | null {
  const kinds = rule.kinds.filter((kind) => on.includes(kind));
  const same = kinds.length === rule.defaults.length && rule.defaults.every((kind) => kinds.includes(kind));
  return same ? null : kinds;
}

export type FirstTextDecision =
  | { send: false; reason: 'nothing' | 'settling' | 'quiet' | 'limit'; close: string[] }
  | { send: true; bubbles: string[]; push: boolean; texted: string[]; close: string[] };

/**
 * Whether a rule texts now. `close` lists events to close unsent (stale, or
 * of a kind switched off); `texted`, on a send, the events the text covers.
 */
export function decideFirstText(input: {
  rule: FirstTextRule;
  enabled: readonly TextKind[];
  events: readonly TextEvent[];
  now: Date;
  timeZone: string;
  /** Texts this rule has sent this UTC day. */
  sentToday: number;
}): FirstTextDecision {
  const { rule, now } = input;
  const at = now.getTime();
  const close: string[] = [];
  const live: TextEvent[] = [];
  for (const event of input.events) {
    const age = at - Date.parse(event.createdAt);
    if (!input.enabled.includes(event.kind) || !(age < STALE_MS)) close.push(event.id);
    else live.push(event);
  }
  if (live.length === 0) return { send: false, reason: 'nothing', close };
  if (isQuietHours(now, input.timeZone)) return { send: false, reason: 'quiet', close };
  if (input.sentToday >= rule.dailyLimit) return { send: false, reason: 'limit', close };

  const times = live.map((e) => Date.parse(e.createdAt));
  const newest = Math.max(...times);
  const oldest = Math.min(...times);
  if (at - newest < SETTLE_MS && at - oldest < BATCH_MAX_MS) return { send: false, reason: 'settling', close };

  const ordered = [...live].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const bubbles = rule.write(ordered).map((b) => b.trim()).filter(Boolean);
  if (bubbles.length === 0) return { send: false, reason: 'nothing', close: [...close, ...live.map((e) => e.id)] };
  return {
    send: true,
    bubbles,
    push: true,
    texted: live.map((e) => e.id),
    close,
  };
}

// ---------------------------------------------------------------------------
// Wording.
// ---------------------------------------------------------------------------

/** A title as a text quotes it: one line, cut at TITLE_QUOTED. */
export function quoted(title: string | null): string {
  const line = (title ?? '').replace(/\s+/g, ' ').trim();
  return line.length > TITLE_QUOTED ? `${line.slice(0, TITLE_QUOTED - 1).trimEnd()}…` : line;
}

/** A sentence's end: a full stop unless the title already ends one. */
function ended(text: string): string {
  return /[.?!…]$/.test(text) ? text : `${text}.`;
}

/** The longest title a list of several quotes beside each outline. */
export const TITLE_LISTED = 40;

/** `a`, `a and b`, `a, b and c`, `a, b, c and 2 more`. */
export function refList(refs: readonly string[]): string {
  const shown = refs.slice(0, 3);
  const more = refs.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/** Each event as a list names it: its outline and a few words of its title, `#2854.2 (Same actions as Ask Dash)`. */
function named(e: TextEvent): string | null {
  if (!e.ref) return null;
  const line = (e.title ?? '').replace(/\s+/g, ' ').trim().replace(/[.?!]$/, '');
  if (!line) return e.ref;
  return `${e.ref} (${cutAtWord(line, TITLE_LISTED)})`;
}

/** A line cut to `max` characters at the last whole word, with an ellipsis. */
export function cutAtWord(line: string, max: number): string {
  if (line.length <= max) return line;
  const room = line.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  return `${(space > max / 2 ? room.slice(0, space) : room).replace(/[\s,;:]+$/, '')}…`;
}

const unique = (events: readonly TextEvent[]): TextEvent[] => {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.kind}:${e.ref ?? e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * The Dev events in a builder's voice: what needs the person first, then
 * what shipped, then what broke, one short bubble each and only for those
 * that happened. One event is named with its title; several are counted and
 * listed by outline, each with a few words of its title, so the text says
 * what shipped without opening each one.
 */
export function writeDevBatch(events: readonly TextEvent[]): string[] {
  const all = unique(events);
  const needs = all.filter((e) => e.kind === 'needs_you' || e.kind === 'question');
  const shipped = all.filter((e) => e.kind === 'shipped');
  const broke = all.filter((e) => e.kind === 'failed');
  const refs = (list: TextEvent[]) => list.map(named).filter((r): r is string => !!r);
  const bubbles: string[] = [];

  if (needs.length === 1) {
    const [e] = needs;
    const what = e.kind === 'question' ? 'is a question for you' : 'needs you';
    const title = quoted(e.title);
    bubbles.push(e.ref ? ended(`${e.ref} ${what}${title ? `: ${title}` : ''}`) : ended(title || 'Something on the plan needs you'));
  } else if (needs.length > 1) {
    const list = refList(refs(needs));
    bubbles.push(`${needs.length} things need you${list ? `: ${list}` : ''}.`);
  }

  if (shipped.length === 1) {
    const [e] = shipped;
    const title = quoted(e.title);
    bubbles.push(ended(`Shipped ${e.ref ?? 'a step'}${title ? `: ${title}` : ''}`));
  } else if (shipped.length > 1) {
    const list = refList(refs(shipped));
    bubbles.push(`Shipped ${shipped.length}${list ? `: ${list}` : ''}.`);
  }

  if (broke.length === 1) {
    const [e] = broke;
    const how = e.detail === 'stalled' ? 'stalled' : 'failed';
    bubbles.push(e.ref ? `The build of ${e.ref} ${how}.` : `A build ${how}.`);
  } else if (broke.length > 1) {
    const list = refList(refs(broke));
    bubbles.push(`${broke.length} builds failed or stalled${list ? `: ${list}` : ''}.`);
  }

  return bubbles;
}

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

/**
 * The builder's rule: whoever is on People under the key `builder` texts
 * about the plan by it. The builder was added as that person by you 0044
 * (plan #2854.5); lib/you/builder-model.ts has the rest of what makes it the
 * builder.
 */
export const BUILDER_TEXTS: FirstTextRule = {
  key: BUILDER_KEY,
  kinds: TEXT_KINDS,
  defaults: TEXT_KINDS,
  dailyLimit: 4,
  write: writeDevBatch,
};

/** Every rule, one per person who texts first by events. */
export const FIRST_TEXT_RULES: readonly FirstTextRule[] = [BUILDER_TEXTS];

export function ruleFor(key: string): FirstTextRule | null {
  return FIRST_TEXT_RULES.find((rule) => rule.key === key) ?? null;
}
