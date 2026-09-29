import { sampleFor } from '@/lib/learn/vault/classify-payload';
import type { MapNoteClass } from '@/lib/vault/map/rules';

/**
 * The map's note classifier as two questions for Jev (plan #1168).
 *
 * Haiku's prompt in classify.ts asks for a class, an evidence flag and a
 * reason in one call. Jev answers the class as a choice and the flag as a
 * yes/no, each with a confidence, and gives no reason: Haiku writes one only
 * for a note Jev is unsure of. Each option means what Haiku is told it means,
 * because the job-email trial found Jev weak where a label's wording and the
 * pipeline's meaning drifted apart.
 *
 * Jev reads what Haiku reads: the title and the opening of the body
 * (sampleFor), never the path.
 */

/**
 * Whether the sweep asks Jev at all. Off until the map trial
 * (docs/trials/2026-09-19-map-75-notes.md, re-run through
 * /api/cron/jev-vault-trial) shows Jev routes the trial's notes at least as
 * well as Haiku. Turning it on is changing this to true; an account also has
 * to have opted in (lib/jev/enabled.ts).
 */
export const VAULT_CLASS_ON_JEV = false;

export const MAP_CLASS_OPTIONS: Readonly<Record<MapNoteClass, string>> = {
  knowledge:
    "Argues something. It states what is true, why it works, what follows from it, or what somebody should do and why: a book's argument written down, a course boiled down to its takeaways, an opinion with reasons attached, or one sentence stating a view plainly.",
  mixed:
    "Carries an argument inside something else: a note about a conversation that also states a position, application prose that argues a thesis, or meeting notes where somebody's reasoning was written down.",
  operational:
    'Logistics and records with nothing argued: travel plans, contact details, meeting times, task lists, dated logs of measurements, or drafts with nothing stated yet.',
};

export const MAP_CLASS_QUESTION = {
  type: 'choice',
  question:
    'This is one of somebody\'s personal notes. Only notes that argue something are read closely. What kind of note is it? Judge the prose rather than the title. Where it sits between two kinds, choose the one that decides correctly what happens next: "knowledge" and "mixed" are read closely, "operational" is not.',
  options: MAP_CLASS_OPTIONS,
} as const;

export const MAP_EVIDENCE_QUESTION = {
  type: 'yes-no',
  question:
    'Does this note describe what a person has done, studied or can do, such as coursework, a transcript, a CV or a job application?',
  yes: 'It records what somebody did, studied or can do, whether or not it also argues something.',
  no: "It is not a record of anyone's study, work or experience.",
} as const;

export function mapClassState(note: { title: string; body: string }): Record<string, string> {
  return { title: note.title, text: sampleFor(note.body) };
}
