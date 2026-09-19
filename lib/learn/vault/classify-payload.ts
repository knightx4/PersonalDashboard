import { z } from 'zod';

/**
 * What a vault note is, before anything decides whether to read it properly.
 *
 * The vault holds 1,244 notes and only some of them argue about anything. The
 * rest are travel plans, job applications, contact details and meeting times.
 * Extraction on all of them costs four times what it needs to and fills the
 * graph with things nobody would ever want probed.
 *
 * Folders cannot do this job. The 30-note trial tried: a note in `Me/` about a
 * friend's wedding carried one of the three best claims in the sample, and a
 * dated drug log in an included folder carried nothing. The difference is in
 * the prose, so the prose is what gets read.
 *
 * Split from the call so the classes, the routing decision and the sampling
 * can be tested without a network.
 */

export const NOTE_CLASSES = ['knowledge', 'mixed', 'evidence', 'operational'] as const;

export type NoteClass = (typeof NOTE_CLASSES)[number];

/**
 * How much of a note the classifier reads.
 *
 * Enough to tell an argument from a shopping list, and no more: this runs once
 * per note across the whole vault, so the sample size is most of what the pass
 * costs. A note that opens with front matter or a list of links and turns into
 * an argument on line forty is the case this gets wrong, and it is cheaper to
 * re-read those later than to read everything in full now.
 */
export const SAMPLE_CHARS = 1_500;

export function sampleFor(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= SAMPLE_CHARS ? trimmed : trimmed.slice(0, SAMPLE_CHARS);
}

/**
 * Which classes are worth a full extraction pass.
 *
 * `evidence` is the interesting exclusion. A transcript, a CV or an
 * application describes what somebody can do rather than arguing a position,
 * so it produces no concepts -- but it is the best evidence in the vault about
 * what they were actually taught, and a later slice reads it to raise
 * confidence in concepts found elsewhere. Skipping it here is about where it
 * is read, not about whether it matters.
 */
export function goesToExtraction(noteClass: NoteClass): boolean {
  return noteClass === 'knowledge' || noteClass === 'mixed';
}

export const classifyPayloadSchema = z.object({
  class: z.enum(NOTE_CLASSES),
  /** One short sentence, shown on the screen so a wrong call can be argued with. */
  reason: z.string().trim().min(1).max(300),
});

export type ClassifyPayload = z.infer<typeof classifyPayloadSchema>;

/**
 * A note too short to classify is operational.
 *
 * 608 of the vault's notes are under 400 characters and most are a line that
 * meant something at the time. Spending a call to be told so is the single
 * easiest saving in the pass, and the floor is low enough that a real claim
 * stated in one sentence still clears it.
 */
export const MIN_BODY_CHARS = 200;

export function tooShortToRead(body: string): boolean {
  return body.trim().length < MIN_BODY_CHARS;
}
