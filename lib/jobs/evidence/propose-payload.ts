/**
 * Shape and validation for proposed evidence items, kept free of server-only
 * imports so the parsing rules can be tested directly (same split as
 * lib/jobs/enrich/ai-company-payload.ts).
 *
 * The parsing here is stricter than the model call needs it to be, on purpose.
 * A proposed item is one click from the bank, and a bad item in the bank
 * silently poisons every match and every draft downstream. Anything vague
 * enough to be a summary of a resume rather than a story is dropped here
 * rather than shown as a candidate.
 */
import { z } from 'zod';

/** What the source material is, which changes how it should be read. */
export type EvidenceSourceKind = 'resume' | 'answers' | 'debriefs';

/** Matches the `evidence_items` columns the form writes. */
export interface EvidenceCandidate {
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
  skills: string[];
  strength: number;
}

export type EvidenceProposalResult =
  | { ok: true; candidates: EvidenceCandidate[] }
  | { ok: false; error: string };

/**
 * Short enough that the model cannot pass a paragraph off as a story, long
 * enough that a real two-sentence accomplishment survives.
 */
const MIN_BODY = 60;

/** One call proposes at most this many. More than this is not reviewable. */
export const MAX_CANDIDATES = 12;

const candidateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1),
  context: z.string().trim().max(400).nullish(),
  metrics: z.string().trim().max(400).nullish(),
  skills: z.array(z.string()).nullish(),
  strength: z.number().int().min(1).max(5).nullish(),
});

export const evidenceProposalSchema = z.object({
  candidates: z.array(candidateSchema).nullish(),
  no_data: z.boolean().nullish(),
});

/** The same normalisation the manual form applies, so tags stay comparable. */
export function normalizeSkills(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const skill = entry.trim().toLowerCase().replace(/\s+/g, '_');
    if (!skill || seen.has(skill)) continue;
    seen.add(skill);
    out.push(skill);
    if (out.length === 8) break;
  }
  return out;
}

/** Two candidates are the same story if they open the same way. */
function dedupeKey(candidate: EvidenceCandidate): string {
  return candidate.body.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 80);
}

/**
 * Validate a proposal into candidates, or explain why not.
 *
 * Bodies shorter than a couple of sentences are dropped rather than rejecting
 * the whole payload: a resume yields a mix of real stories and one-line skill
 * claims, and losing the thin ones is better than losing the batch.
 */
export function parseEvidenceProposalPayload(raw: unknown): EvidenceProposalResult {
  const parsed = evidenceProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The proposal came back in an unexpected shape.' };
  }
  if (parsed.data.no_data) {
    return { ok: false, error: 'Nothing in that source reads as a story worth banking.' };
  }

  const seen = new Set<string>();
  const candidates: EvidenceCandidate[] = [];

  for (const entry of parsed.data.candidates ?? []) {
    if (entry.body.length < MIN_BODY) continue;

    const candidate: EvidenceCandidate = {
      title: entry.title,
      body: entry.body,
      context: entry.context?.trim() || null,
      metrics: entry.metrics?.trim() || null,
      skills: normalizeSkills(entry.skills ?? []),
      strength: entry.strength ?? 3,
    };

    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push(candidate);
    if (candidates.length === MAX_CANDIDATES) break;
  }

  if (candidates.length === 0) {
    return { ok: false, error: 'Nothing in that source reads as a story worth banking.' };
  }
  return { ok: true, candidates };
}
