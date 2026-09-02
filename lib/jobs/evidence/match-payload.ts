/**
 * Shape and validation for a requirement match, kept free of server-only
 * imports so the parsing rules — and the key that decides when a match goes
 * stale — can be tested directly.
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import type { Requirement, RequirementKind } from '../jd/requirements';

/** How well your record answers one line of the description. */
export type MatchVerdict = 'strong' | 'partial' | 'gap';

export interface RequirementMatch {
  /** The requirement text, copied so the row reads without a second lookup. */
  requirement: string;
  kind: RequirementKind;
  verdict: MatchVerdict;
  /** Null on a gap, and on a gap only. */
  evidenceItemId: string | null;
  /** One line on why it is that verdict. */
  why: string;
}

export type MatchResult =
  | { ok: true; matches: RequirementMatch[] }
  | { ok: false; error: string };

const matchSchema = z.object({
  matches: z
    .array(
      z.object({
        // The index into the list as sent, not the text: asking the model to
        // echo forty requirement strings back wastes output tokens and gives
        // it the chance to paraphrase the line it is scoring.
        requirement_index: z.number().int().min(0),
        verdict: z.enum(['strong', 'partial', 'gap']),
        evidence_item_id: z.string().nullish(),
        why: z.string().trim().max(400).nullish(),
      }),
    )
    .nullish(),
});

/**
 * Validate a reported match against the requirements that were sent and the
 * evidence that was shortlisted.
 *
 * Both are checked rather than trusted. A cited item that was not in the
 * shortlist is a hallucinated id, and a verdict of strong or partial with no
 * usable citation is exactly the ungrounded claim this layer exists to catch —
 * both are downgraded to a gap rather than shown as a match, because a wrong
 * "covered" is worse than a missing one: it is the reading that costs you the
 * hour rather than saving it.
 */
export function parseMatchPayload(
  raw: unknown,
  requirements: readonly Requirement[],
  shortlistedIds: readonly string[],
): MatchResult {
  const parsed = matchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The match came back in an unexpected shape.' };
  }

  const allowed = new Set(shortlistedIds);
  const byIndex = new Map<number, RequirementMatch>();

  for (const row of parsed.data.matches ?? []) {
    const requirement = requirements[row.requirement_index];
    if (!requirement) continue;
    // First verdict wins, so a repeated index cannot overwrite a scored line.
    if (byIndex.has(row.requirement_index)) continue;

    const cited = row.evidence_item_id && allowed.has(row.evidence_item_id)
      ? row.evidence_item_id
      : null;
    const grounded = cited !== null && row.verdict !== 'gap';

    byIndex.set(row.requirement_index, {
      requirement: requirement.text,
      kind: requirement.kind,
      verdict: grounded ? row.verdict : 'gap',
      evidenceItemId: grounded ? cited : null,
      why: grounded
        ? row.why?.trim() || 'Matched, with no reason given.'
        : row.verdict === 'gap'
          ? row.why?.trim() || 'Nothing in the bank covers this.'
          : 'Nothing in the bank covers this — the match cited an item that was not offered.',
    });
  }

  if (byIndex.size === 0) return { ok: false, error: 'The match came back empty.' };

  // Every requirement gets a row, in the order the description had them. A
  // line the model skipped is a gap, not a line that quietly disappears from
  // the map — a silently short map reads as better coverage than there is.
  return {
    ok: true,
    matches: requirements.map(
      (requirement, index) =>
        byIndex.get(index) ?? {
          requirement: requirement.text,
          kind: requirement.kind,
          verdict: 'gap' as const,
          evidenceItemId: null,
          why: 'Not scored.',
        },
    ),
  };
}

/**
 * When a stored match stops being valid.
 *
 * A hash of the description it was computed against and a fingerprint of the
 * bank at the time. Both matter: a rewritten JD asks different questions, and
 * an item added to the bank may be the answer to a line that was a gap. The
 * strength and skills go into the fingerprint alongside the ids, because
 * editing an item changes what it can answer without changing which items
 * exist.
 */
export function matchKey(
  jdHash: string | null,
  bank: readonly { id: string; strength: number; skills: string[] }[],
): string {
  const fingerprint = [...bank]
    .map((item) => `${item.id}:${item.strength}:${[...item.skills].sort().join('|')}`)
    .sort()
    .join(',');
  return createHash('sha1').update(`${jdHash ?? 'no-jd'}\n${fingerprint}`).digest('hex');
}
