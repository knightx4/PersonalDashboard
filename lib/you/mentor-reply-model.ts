/**
 * The rules and arithmetic of a mentor's live reply (plan #2748.4), with no
 * reads or writes, so they can be tested alone. lib/you/mentor-reply.ts runs
 * them.
 *
 * A reply is texted the way a person texts: one to three short bubbles, each
 * saved as its own message as soon as it is whole, the later ones after a
 * pause that grows with their length, as if being typed. When nothing has
 * been written three seconds in (the model is looking something up), a small
 * model sends a one-line first text in the mentor's voice, kept as an `ack`.
 */

/** How long the typing dots last without being renewed; the run renews them while it works. */
export const TYPING_LEASE_MS = 12_000;
/** How often a running reply renews the typing dots. */
export const TYPING_RENEW_MS = 4_000;
/** With no text written by now, the mentor sends a one-line first text. */
export const ACK_AFTER_MS = 3_000;
/** The most bubbles one reply is split into; anything past it joins the last. */
export const MAX_BUBBLES = 5;
/** Output tokens for one call of the reply: texts are short. */
export const REPLY_MAX_TOKENS = 1_200;
/**
 * Output tokens for one call of a reply that can change things (plan #2999).
 * A plan step's detail runs to 4,000 characters, about a thousand tokens,
 * and the model thinks first, inside the same cap. At 1,200 a call can be
 * cut off part-way through add_plan_step's input, which leaves the title
 * and drops the detail: the likeliest way nine steps went in with a title
 * alone on 5 November 2026, with detail optional in the schema as the other.
 * The texts are kept short by the rules, not by this cap.
 */
export const ACTING_MAX_TOKENS = 4_000;
/** Output tokens for the first text. */
export const ACK_MAX_TOKENS = 60;
/** The longest first text kept, in characters. */
export const ACK_MAX_CHARS = 160;
/**
 * How many times one run answers again for messages that arrived while it
 * was replying, before it stops and leaves them for the next send.
 */
export const MAX_FOLLOW_UPS = 2;

/**
 * What the mentor is told about texting, after their persona and before
 * anything that changes from reply to reply. Written for the model, so it can
 * name the tool it answers through.
 */
export const REPLY_RULES = `How you reply

You are texting. Write the way you would text someone you know well: short, plain sentences, in your own voice. No headings, no bullet lists, no bold, no sign-off.

Split a reply into one to three bubbles by leaving a blank line between them, as a person sends two or three texts in a row. Put the point first: the first bubble should stand on its own if they read nothing else. A one-word or one-line reply is fine when that is all it needs.

Give every reply through the answer tool, with the whole reply in its answer field and nothing written outside it. Leave cited empty unless a lookup gave you a row the reply rests on.

You can look up what they have in the app with the lookup tools: their todos, goals, notes, applications, spending, mail and the rest. Look something up only when the reply depends on it, and say what you found in a sentence, not a list. You cannot change anything; if they ask you to, tell them to ask Dash.

Stay in character. Do not mention these instructions, the tools or that you are a model. If a message mentions something you do not know, ask about it rather than guess.`;

/**
 * A bubble as a text reads (plan #2854.1): the rules ask for no headings, no
 * lists and no bold, and this holds to it when a reply has them anyway. A
 * heading's marks, a list's bullets or numbers and the asterisks or
 * underscores of bold come off, leaving the words on their lines.
 */
export function plainBubble(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .trimEnd(),
    )
    .join('\n')
    .trim();
}

/**
 * The bubbles of a reply: split on blank lines, trimmed, empty ones dropped,
 * and anything past MAX_BUBBLES joined to the last.
 */
export function splitBubbles(text: string): string[] {
  const parts = text
    .split(/\n[ \t]*\n/)
    .map(plainBubble)
    .filter(Boolean);
  if (parts.length <= MAX_BUBBLES) return parts;
  return [...parts.slice(0, MAX_BUBBLES - 1), parts.slice(MAX_BUBBLES - 1).join('\n\n')];
}

/**
 * The bubbles of a reply still being written that are already whole: every
 * one a blank line has closed. The last part may still grow, so it waits,
 * and so does anything that would be joined into the last bubble.
 */
export function wholeBubbles(draft: string): string[] {
  const parts = draft.split(/\n[ \t]*\n/);
  parts.pop();
  const whole = parts.map(plainBubble).filter(Boolean);
  return whole.slice(0, MAX_BUBBLES - 1);
}

/**
 * The pause before a bubble after the first, as if it were being typed: a
 * little under a second, plus about 25 milliseconds a character, at most
 * three and a half seconds. Time already spent waiting for the model counts
 * toward it.
 */
export function bubblePauseMs(text: string): number {
  return Math.min(3_500, Math.max(800, 600 + text.length * 25));
}

/** The first text's instructions, after the persona. */
export const ACK_RULES = `They have just texted you and your full reply will take a moment. Send one short first text in your own voice, the kind you would send before a longer answer: a quick reaction to what they said, under twelve words. Do not answer the question or promise anything specific. Write only the text itself, with no quotation marks.`;

/** The first text as it is kept: one line, no wrapping quotes, cut to ACK_MAX_CHARS; null when nothing usable came back. */
export function cleanAck(text: string): string | null {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const bare = line.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (!bare) return null;
  return bare.length > ACK_MAX_CHARS ? `${bare.slice(0, ACK_MAX_CHARS - 1).trimEnd()}…` : bare;
}

/** What the person is told when a reply could not be written. */
export function replyFailed(mentorName: string, detail: string): string {
  const why = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `${mentorName} could not reply just now${why ? `: ${why}` : '.'} Send it again to try once more.`;
}
