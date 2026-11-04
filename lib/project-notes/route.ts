import { isSure, triageLine, type Triage } from '@/lib/feedback/triage';

/**
 * Notes filed from a project's own app (docs/PROJECT-NOTES.md).
 *
 * A project such as the music studio is built in its own repository, so a
 * note about it has no place in Dev · Notes, which the notes routine works in
 * this repository. Instead it is filed as an idea under the project, and
 * triage decides where it goes from there: a note triage is sure is one fix
 * becomes a step under the project's standing feedback feature, ready for the
 * projects routine to build in the right repository; anything else goes
 * straight on to be shaped into a feature on the plan (lib/ideas/send-to-plan.ts),
 * as a note from Dash's own header does. Nothing waits on the ideas page.
 *
 * This file is the pure part: the decision and the words written. The
 * writing is lib/project-notes/file.ts.
 */

/**
 * Where a project note ended up: a step, or sent to be shaped into a feature
 * (`'idea'` on the wire, which the apps already read; the idea is the record
 * the shaping run links its feature to).
 */
export type ProjectNoteOutcome = { as: 'step'; number: number } | { as: 'idea' };

/** A step only when triage is sure it is one fix; unsure, or no triage at all, is shaped into a feature. */
export function routesToStep(triage: Triage | null): boolean {
  const route = triage?.route ?? null;
  return route !== null && route.value === 'fix' && isSure(route);
}

/** The standing feature a project's one-fix notes are steps under. */
export function feedbackFeatureTitle(projectLabel: string): string {
  return `Fixes from notes filed in ${projectLabel}`;
}

export function feedbackFeatureDetail(projectLabel: string): string {
  return (
    `Notes written in ${projectLabel}'s own app with its note button land here as steps ` +
    'when triage reads them as one fix. Larger ones are shaped into features of their own on the plan. ' +
    'This feature stays open; close a step, not the feature.'
  );
}

/** A step's title is the note's first line, as a note or an idea is named. */
export function noteStepTitle(body: string): string {
  return triageLine(body, 200);
}

/** The step's detail: the note in full and where in the app it was written. */
export function noteStepDetail(body: string, page: string | null): string {
  const where = page ? `\n\nWritten on: ${page}` : '';
  return `Filed from the app's note button.\n\n${body.trim()}${where}`;
}

/** The idea's body: the note, with where it was written when the app said. */
export function noteIdeaBody(body: string, page: string | null): string {
  return page ? `${body.trim()}\n\n(Written on: ${page})` : body.trim();
}

/** What the app shows once the note is filed. */
export function outcomeLine(outcome: ProjectNoteOutcome): string {
  return outcome.as === 'step'
    ? `Added to the plan as step #${outcome.number}.`
    : 'Sent to Dash to shape into the plan.';
}
