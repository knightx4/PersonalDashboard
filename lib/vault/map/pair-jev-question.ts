import type { JevChoiceAnswer } from '@/lib/jev/client';
import { MAP_EDGE_TYPES, type MapEdgeType } from '@/lib/learn/graph/position-prompt';

/**
 * The merge and link passes as one Jev question per pair (plan #1169).
 *
 * Haiku's prompts in merge-themes.ts, merge-positions.ts and link-positions.ts
 * judge twenty pairs a call and write a reason for each. Jev answers one pair
 * at a time as a choice, with a probability on every option and no reason.
 * Each option is worded from what the Haiku prompt says that answer means,
 * because the job-email trial found Jev weak where a label's wording and the
 * pipeline's meaning drifted apart.
 *
 * Where Haiku gave two fields, the options carry both, so one question settles
 * the pair: "same, keep A's name" and "same, keep B's name" for a merge, and
 * each directed edge type as its own option for a link. The verdict is then
 * read from the summed probabilities (readMergeAnswer, readLinkAnswer), so a
 * pair Jev thinks is one subject but cannot pick a name for is still `same`.
 * Jev cannot coin a name, so a merge keeps one of the two it was shown.
 */

/**
 * Whether the passes ask Jev at all. An account also has to have opted in
 * (lib/jev/enabled.ts). Setting this to false puts every account back on
 * Haiku alone.
 */
export const MAP_PAIRS_ON_JEV = true;

/**
 * Jev's answer stands at any confidence, and is written with that
 * confidence, as Haiku's were: pairs are not sent to Haiku for a second
 * opinion (the step's own detail). Every `same` proposal is merged without
 * review and undone from the merge log (#814), and a low-confidence answer
 * is reviewed there as a low-confidence Haiku answer was. Haiku still judges
 * a pair when Jev fails. Setting this to 0.8 sends the pairs Jev is less sure
 * of to Haiku, batched as before.
 */
export const MAP_PAIRS_JEV_FLOOR = 0;

// ---------------------------------------------------------------------------
// Merges

export type MergeLabel = 'different' | 'same_keep_a' | 'same_keep_b';

export type MergeRead = { same: boolean; keep: 'A' | 'B' | null; confidence: number };

const THEME_OPTIONS: Readonly<Record<MergeLabel, string>> = {
  different:
    'Two subjects: related subjects that each deserve their own place on the list, such as two branches of one field ("Monetary policy" and "Fiscal policy"), or a pair where the only heading that covers both is a whole discipline such as "Economics" or "Psychology".',
  same_keep_a:
    'One subject, and A\'s name already covers both. Somebody listing what they write about would put both under one heading: two wordings of one subject ("Housing affordability crisis" and "Housing supply and affordability"), or a narrow theme that is one facet of a broader theme that is still a specific subject ("15-minute cities" and "Urban design and travel patterns").',
  same_keep_b:
    'One subject, and B\'s name already covers both. Somebody listing what they write about would put both under one heading: two wordings of one subject ("Housing affordability crisis" and "Housing supply and affordability"), or a narrow theme that is one facet of a broader theme that is still a specific subject ("15-minute cities" and "Urban design and travel patterns").',
};

export const THEME_MERGE_QUESTION = {
  type: 'choice',
  question:
    "A and B are two themes on a map of the subjects somebody's personal notes are about, each with a name and one line on what it covers. The map was built one note at a time, so the same subject often appears under two names. Are A and B one subject, and if so, which name should the merged theme carry? Sharing words does not make two themes one, and different wording does not make them two.",
  options: THEME_OPTIONS,
} as const;

const POSITION_OPTIONS: Readonly<Record<MergeLabel, string>> = {
  different:
    'Two positions, including pairs about one subject: a claim and its condition or qualification ("Neighbourhoods should be walkable" and "Neighbourhoods should be walkable where density supports transit"), a general claim and one case of it, the same words about different things ("Communism requires small scale" and "Democracy requires small scale"), a claim and its opposite, or a claim and a reason for it.',
  same_keep_a:
    'One position, and A\'s name fits it. The two statements make one assertion: everybody who holds A answers the question that separates holders from non-holders the way somebody who holds B would, and the other way round. Two wordings of one claim, such as "Seeking meaning through extremes fails" and "Searching meaning in extremes fails".',
  same_keep_b:
    'One position, and B\'s name fits it. The two statements make one assertion: everybody who holds A answers the question that separates holders from non-holders the way somebody who holds B would, and the other way round. Two wordings of one claim, such as "Seeking meaning through extremes fails" and "Searching meaning in extremes fails".',
};

export const POSITION_MERGE_QUESTION = {
  type: 'choice',
  question:
    "A and B are two positions from different notes on a map of what somebody's personal notes assert. Each is one thing the writer can be right or wrong about, with a short name, a kind and a statement. The map was built one note at a time, so a position the writer returns to appears once per note, in different words. Are A and B one position, and if so, which name should it carry? Sharing words does not make two positions one, and different wording does not make them two. The kind is a guess made when the note was read; two sides of different kinds can still be one position.",
  options: POSITION_OPTIONS,
} as const;

export function themeMergeState(pair: {
  a: { name: string; about: string; notes: number };
  b: { name: string; about: string; notes: number };
}): Record<string, unknown> {
  const side = (theme: { name: string; about: string; notes: number }) => ({
    name: theme.name,
    covers: theme.about,
    notes: theme.notes,
  });
  return { A: side(pair.a), B: side(pair.b) };
}

export function positionState(pair: {
  a: { name: string; statement: string; kind: string };
  b: { name: string; statement: string; kind: string };
}): Record<string, unknown> {
  const side = (position: { name: string; statement: string; kind: string }) => ({
    name: position.name,
    kind: position.kind,
    statement: position.statement,
  });
  return { A: side(pair.a), B: side(pair.b) };
}

/**
 * The verdict from Jev's probabilities: `same` when the two "same" options
 * together outweigh "different", keeping the name the likelier of the two
 * picked. The confidence is the verdict's summed probability. With no
 * probabilities, the choice and its confidence as given.
 */
export function readMergeAnswer(answer: JevChoiceAnswer<MergeLabel>): MergeRead {
  const p = answer.probabilities;
  const keepA = p.same_keep_a ?? 0;
  const keepB = p.same_keep_b ?? 0;
  const different = p.different ?? 0;
  if (keepA + keepB + different === 0) {
    if (answer.choice === 'different') {
      return { same: false, keep: null, confidence: answer.confidence };
    }
    return {
      same: true,
      keep: answer.choice === 'same_keep_a' ? 'A' : 'B',
      confidence: answer.confidence,
    };
  }
  if (keepA + keepB > different) {
    return { same: true, keep: keepB > keepA ? 'B' : 'A', confidence: clamp(keepA + keepB) };
  }
  return { same: false, keep: null, confidence: clamp(different) };
}

/**
 * The reason written on a proposal Jev settled, which the merge log shows
 * under the merge. Jev gives none, so it says what was judged and how sure.
 */
export function jevMergeReason(kind: 'theme' | 'position', read: MergeRead): string {
  const sure = `${Math.round(read.confidence * 100)}% sure`;
  if (kind === 'theme') {
    return read.same
      ? `Judged one subject under two names, ${sure}.`
      : `Judged two subjects, ${sure}.`;
  }
  return read.same
    ? `Judged one position stated twice, ${sure}.`
    : `Judged two positions, ${sure}.`;
}

// ---------------------------------------------------------------------------
// Links

/** The edge types whose direction matters; the other two read the same both ways. */
const DIRECTED = ['requires', 'supports', 'qualifies', 'example_of'] as const;
type Directed = (typeof DIRECTED)[number];

export type LinkLabel = 'none' | 'contradicts' | 'same_as' | `a_${Directed}_b` | `b_${Directed}_a`;

export type LinkRead = {
  relation: MapEdgeType | 'none';
  /** The side the edge runs from; null for none. */
  from: 'A' | 'B' | null;
  confidence: number;
};

/** What each directed type means with X as the side the edge runs from. */
const DIRECTED_MEANING: Record<Directed, (x: string, y: string) => string> = {
  requires: (x, y) =>
    `You cannot understand ${y} at all without ${x}. Rare: most pairs that feel like this are "${x.toLowerCase()}_supports_${y.toLowerCase()}".`,
  supports: (x, y) => `${y} is true partly because ${x} is: ${x} is part of why ${y} holds.`,
  qualifies: (x, y) => `${x} bounds or conditions ${y}: it says where, when or how far ${y} holds.`,
  example_of: (x, y) => `${x} is a concrete case of the more abstract ${y}.`,
};

function linkOptions(): Record<LinkLabel, string> {
  const options = {
    none: 'No relation: the two only share a subject. Two claims about cities that neither supports, bounds nor cuts against the other are not related. No edge is better than a guessed one.',
    contradicts:
      'A and B cannot both stand: holding both would be inconsistent, not merely a difference in emphasis.',
    same_as: 'A and B are one idea under two names.',
  } as Record<LinkLabel, string>;
  for (const type of DIRECTED) {
    options[`a_${type}_b`] = DIRECTED_MEANING[type]('A', 'B');
    options[`b_${type}_a`] = DIRECTED_MEANING[type]('B', 'A');
  }
  return options;
}

export const LINK_QUESTION = {
  type: 'choice',
  question:
    "A and B are two positions from different notes on a map of what somebody's personal notes assert. Each is one thing the writer can be right or wrong about, with a short name, a kind and a statement. Which relation joins them, if any? It is one a careful reader of both notes would see, not one either note states.",
  options: linkOptions(),
} as const;

/** The relation and direction one label stands for. */
export function linkLabelMeaning(label: LinkLabel): {
  relation: MapEdgeType | 'none';
  from: 'A' | 'B' | null;
} {
  if (label === 'none') return { relation: 'none', from: null };
  // Either side reads the same for these; A is what Haiku was free to give too.
  if (label === 'contradicts' || label === 'same_as') return { relation: label, from: 'A' };
  const from = label.startsWith('a_') ? 'A' : 'B';
  const relation = label.slice(2, -2) as Directed;
  return { relation, from };
}

/**
 * The relation from Jev's probabilities: the relation whose options together
 * are likeliest, running from the side its likelier option names. The
 * confidence is that relation's summed probability. With no probabilities,
 * the choice and its confidence as given.
 */
export function readLinkAnswer(answer: JevChoiceAnswer<LinkLabel>): LinkRead {
  const totals = new Map<MapEdgeType | 'none', number>();
  const best = new Map<MapEdgeType | 'none', { label: LinkLabel; p: number }>();
  let sum = 0;
  for (const [label, p] of Object.entries(answer.probabilities) as [LinkLabel, number][]) {
    if (!(label in LINK_QUESTION.options)) continue;
    const { relation } = linkLabelMeaning(label);
    totals.set(relation, (totals.get(relation) ?? 0) + p);
    const current = best.get(relation);
    if (!current || p > current.p) best.set(relation, { label, p });
    sum += p;
  }
  if (sum === 0) return { ...linkLabelMeaning(answer.choice), confidence: answer.confidence };

  let top: MapEdgeType | 'none' = 'none';
  let topP = -1;
  // Ties go to none, then to the order the edge types are listed in.
  for (const relation of ['none', ...MAP_EDGE_TYPES] as const) {
    const p = totals.get(relation) ?? 0;
    if (p > topP) {
      top = relation;
      topP = p;
    }
  }
  const label = best.get(top)?.label ?? 'none';
  return { ...linkLabelMeaning(label), confidence: clamp(topP) };
}

/** Into 0 to 1, to three places, so a sum of probabilities is stored without float noise. */
function clamp(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}
