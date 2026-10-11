import { BIG_FIVE_FACTORS, factorPercent, type BigFiveFactor, type BigFiveScores } from './ipip';

/**
 * Which vault themes lie closest to each of your Big Five traits (plan #1634).
 *
 * Each end of each trait has one sentence describing a person at that end.
 * The sentence for the end your score leans to is embedded once, kept by its
 * hash in obsidian.text_embeddings like any page text (lib/vault/notes/related.ts),
 * and compared with every theme's vector through obsidian.nearest_themes. No
 * model writes anything, and after the first visit nothing is embedded again.
 *
 * This file is the pure half: the sentences, which end is asked about, and
 * how the candidates are shared out. trait-themes-load.ts does the reading.
 */

/** How many themes are shown under a trait. */
export const THEMES_PER_TRAIT = 3;

/**
 * How many of the nearest themes are read for each trait before they are
 * shared out. Enough that a trait still has three of its own when its
 * closest few sit closer still to another trait.
 */
export const CANDIDATES_PER_TRAIT = 12;

export type TraitEnd = 'high' | 'low';

/** A person at each end of each trait, in a sentence. What is embedded. */
export const TRAIT_SENTENCES: Record<BigFiveFactor, Record<TraitEnd, string>> = {
  extraversion: {
    high: 'Someone outgoing and talkative who seeks out company, parties and conversation, and is energised by being around other people.',
    low: 'Someone reserved and quiet who prefers solitude, small circles and time alone, and recharges away from crowds.',
  },
  agreeableness: {
    high: "Someone warm and trusting who cares about other people's feelings, cooperates readily, and goes out of their way to help.",
    low: "Someone blunt and sceptical who questions other people's motives, argues their corner, and puts honesty before harmony.",
  },
  conscientiousness: {
    high: 'Someone organised and disciplined who plans ahead, keeps routines and habits, and follows through on goals.',
    low: 'Someone flexible and spontaneous who improvises, resists schedules and routines, and lets plans change as they go.',
  },
  emotional_stability: {
    high: 'Someone calm and even-tempered who handles stress well, rarely worries, and recovers quickly from setbacks.',
    low: 'Someone prone to worry and anxiety whose moods shift, who feels stress keenly and dwells on what might go wrong.',
  },
  intellect: {
    high: 'Someone curious and imaginative who is drawn to ideas, philosophy, art and abstract questions, and loves learning.',
    low: 'Someone practical and down to earth who prefers concrete tasks, familiar routines and what works over abstract theory.',
  },
};

/** The end a score leans to: high from the middle of the range up. */
export function traitEnd(sum: number): TraitEnd {
  return factorPercent(sum) >= 50 ? 'high' : 'low';
}

/** The sentence embedded for each trait, given the scores. */
export function traitSentences(scores: BigFiveScores): Record<BigFiveFactor, string> {
  const out = {} as Record<BigFiveFactor, string>;
  for (const factor of BIG_FIVE_FACTORS) out[factor] = TRAIT_SENTENCES[factor][traitEnd(scores[factor])];
  return out;
}

/** A theme as obsidian.nearest_themes returns it. */
export type ThemeCandidate = { id: string; name: string; similarity: number };

/** A theme shown under a trait. The score is not shown (law 3). */
export type TraitTheme = { id: string; name: string };

export type TraitThemes = Record<BigFiveFactor, TraitTheme[]>;

/**
 * Share the candidates out so each trait gets its closest themes and no theme
 * shows under two traits.
 *
 * Greedy over every (trait, theme) pair, closest first: a pair is taken when
 * its trait still has room and its theme is not already shown. A theme close
 * to everything, such as one about yourself in general, lands under the trait
 * it is closest to and leaves the other places to themes that set the traits
 * apart. Ties go by the order of the traits, then by name, so the same inputs
 * always give the same page.
 */
export function shareOutThemes(
  candidates: Record<BigFiveFactor, readonly ThemeCandidate[]>,
  perTrait = THEMES_PER_TRAIT,
): TraitThemes {
  const pairs = BIG_FIVE_FACTORS.flatMap((factor, order) =>
    (candidates[factor] ?? [])
      .filter((c) => Number.isFinite(c.similarity))
      .map((c) => ({ factor, order, c })),
  ).sort(
    (a, b) =>
      b.c.similarity - a.c.similarity || a.order - b.order || a.c.name.localeCompare(b.c.name),
  );

  const out = Object.fromEntries(BIG_FIVE_FACTORS.map((f) => [f, [] as TraitTheme[]])) as TraitThemes;
  const used = new Set<string>();
  for (const { factor, c } of pairs) {
    if (used.has(c.id) || out[factor].length >= perTrait) continue;
    used.add(c.id);
    out[factor].push({ id: c.id, name: c.name });
  }
  return out;
}
