import type { JevQuestion } from '@/lib/jev/wire';

/**
 * Holding a Claude step that acts outside the plan (plan #1183).
 *
 * Dash is told to file a step that sends, submits, books, buys or changes
 * records elsewhere as a proposal carrying an `acts` sentence, and the
 * database refuses to let it work an approved step that has one
 * (migrations-goals/0042). Both depend on Dash noticing. This is the check
 * that does not: before a goals run starts, and when a step is sent, Jev is
 * asked about every open Claude step with no sentence, and a step it thinks
 * might act is turned back into a proposal with a sentence Haiku writes.
 *
 * The rules live here, with no I/O, so the report-only trial
 * (scripts/goals-hold-acts-trial.ts) and the live check
 * (lib/goals/hold-acts-store.ts) ask the same question and hold at the same
 * line.
 */

/**
 * Jev's probability of a yes at or above which a step is held. Low on
 * purpose: a false alarm costs the person one press on a proposal, and a
 * miss sends an email they did not approve (feature #1182).
 */
export const HOLD_ACTS_THRESHOLD = 0.3;

/** The sentence Haiku writes is stored in `items.acts`, which takes 500 characters. */
export const ACTS_MAX = 500;

/** How many steps are put to Jev at once. */
export const HOLD_ACTS_CONCURRENCY = 4;

export const ACTS_QUESTION = {
  type: 'yes-no',
  question:
    'Does working this step send, submit, book, buy, share, or change records outside the goals schema?',
  yes:
    'Working it sends an email or message, submits a form or application, books or buys something, posts or shares something, or changes records in another app, account or service.',
  no:
    'Its work stays inside the plan: research, a list, a comparison, a calculation, a draft written on the step for the person to send, or a note.',
} as const satisfies JevQuestion;

/** An open Claude step with no `acts` sentence, as the check reads it. */
export type ActsCandidate = {
  id: string;
  title: string;
  detail: string | null;
  acceptance: string | null;
};

/** What Jev reads about one step: its title, detail and done-when. */
export function actsState(step: ActsCandidate): string {
  const lines = [`Step: ${step.title.trim()}`];
  if (step.detail?.trim()) lines.push(`Detail: ${step.detail.trim()}`);
  if (step.acceptance?.trim()) lines.push(`Done when: ${step.acceptance.trim()}`);
  return lines.join('\n');
}

/** Whether Jev's probability of a yes holds the step. */
export function holdsAt(probability: number): boolean {
  return probability >= HOLD_ACTS_THRESHOLD;
}

/**
 * One step's answer. `probability` is null when Jev could not be asked or did
 * not answer, and such a step is never held: an API error leaves it as it is.
 */
export type ActsCheck<S = ActsCandidate> = {
  step: S;
  probability: number | null;
  held: boolean;
};

/**
 * Ask about every step, a few at a time, and say which would be held. `ask`
 * returns Jev's probability of a yes, or null, and must not throw; one that
 * does is read as null. `holds` is the line, 0.3 unless a caller asking a
 * different question draws its own (the check after a run, plan #1184).
 */
export async function checkActs<S = ActsCandidate>(
  steps: readonly S[],
  ask: (step: S) => Promise<number | null>,
  concurrency: number = HOLD_ACTS_CONCURRENCY,
  holds: (probability: number) => boolean = holdsAt,
): Promise<ActsCheck<S>[]> {
  const out: ActsCheck<S>[] = new Array(steps.length);
  let next = 0;
  const worker = async () => {
    while (next < steps.length) {
      const index = next++;
      const step = steps[index];
      let probability: number | null;
      try {
        probability = await ask(step);
      } catch {
        probability = null;
      }
      out[index] = { step, probability, held: probability !== null && holds(probability) };
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, steps.length)) }, worker));
  return out;
}

/** What Haiku is told when it writes the sentence for a held step. */
export const ACTS_SENTENCE_SYSTEM = `A personal goals tracker has a step its assistant, Dash, would work. The
step may act outside the plan: send an email or a message, submit a form,
book, buy, post or share something, or change records in another app or
service. Write the one sentence the owner reads before approving it.

Say what working the step does, who it goes to, from where, and what
changes, as far as the step says. Start with a verb in the present tense,
for example "Sends the hardship request to Nelnet from your Gmail." or
"Books a 30-minute call with the landlord through their portal." Address the
owner as "you". Do not guess a name, address or account the step does not
give; say "the landlord" rather than inventing one.

If working the step does nothing outside the plan, still write the sentence
for the nearest thing it could do outside it.

Reply with the sentence alone, under 200 characters, with no quotation marks.`;

/** The message Haiku reads: the same text Jev read. */
export function actsSentenceMessage(step: ActsCandidate): string {
  return actsState(step);
}

/**
 * Haiku's reply as a sentence fit for `items.acts`: one line, no wrapping
 * quotes, ending in a full stop, at most ACTS_MAX characters. Null when
 * nothing usable came back.
 */
export function cleanActsSentence(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (text.length < 8) return null;
  if (text.length > ACTS_MAX - 1) text = `${text.slice(0, ACTS_MAX - 2).trimEnd()}…`;
  if (!/[.!?…]$/.test(text)) text = `${text}.`;
  return text;
}

/**
 * The sentence a held step carries when Haiku could not write one. The step
 * is held either way, since the miss is the expensive mistake.
 */
export function fallbackActsSentence(step: ActsCandidate): string {
  const title = step.title.replace(/\s+/g, ' ').trim();
  const shown = title.length > 300 ? `${title.slice(0, 299).trimEnd()}…` : title;
  return `Working "${shown}" may send, submit, buy or change something outside the plan; Dash could not say exactly what, so read the step before approving it.`;
}
