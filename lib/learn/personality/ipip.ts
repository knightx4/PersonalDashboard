/**
 * The 50-item IPIP Big Five factor markers and their scoring key (plan #1632).
 *
 * The items are Goldberg's (1992) markers from the International Personality
 * Item Pool, which is in the public domain, in the IPIP's own order. That
 * order is what `learn.personality_results.answers` is stored in, so it never
 * changes: a correction to the key rescores the stored answers, and a
 * reordered list would rescore them against the wrong statements.
 *
 * Each statement is answered 1 to 5, from very inaccurate to very accurate.
 * A plus-keyed item scores its answer; a minus-keyed one scores 6 minus it.
 * A factor is the sum of its ten items, so 10 to 50. No model is involved.
 *
 * The factor names are the IPIP's: emotional stability is the far end of
 * neuroticism, and intellect is its name for openness to experience.
 */

export type BigFiveFactor =
  | 'extraversion'
  | 'agreeableness'
  | 'conscientiousness'
  | 'emotional_stability'
  | 'intellect';

/** The factors in the order the IPIP's items cycle through them. */
export const BIG_FIVE_FACTORS: readonly BigFiveFactor[] = [
  'extraversion',
  'agreeableness',
  'conscientiousness',
  'emotional_stability',
  'intellect',
];

export type IpipItem = {
  /** 1 to 50, the IPIP's numbering. */
  number: number;
  text: string;
  factor: BigFiveFactor;
  keyed: 'plus' | 'minus';
};

/** Statement and key, in IPIP order; the factor follows from the position. */
const ITEMS: ReadonlyArray<readonly [string, '+' | '-']> = [
  ['Am the life of the party.', '+'],
  ['Feel little concern for others.', '-'],
  ['Am always prepared.', '+'],
  ['Get stressed out easily.', '-'],
  ['Have a rich vocabulary.', '+'],
  ["Don't talk a lot.", '-'],
  ['Am interested in people.', '+'],
  ['Leave my belongings around.', '-'],
  ['Am relaxed most of the time.', '+'],
  ['Have difficulty understanding abstract ideas.', '-'],
  ['Feel comfortable around people.', '+'],
  ['Insult people.', '-'],
  ['Pay attention to details.', '+'],
  ['Worry about things.', '-'],
  ['Have a vivid imagination.', '+'],
  ['Keep in the background.', '-'],
  ["Sympathize with others' feelings.", '+'],
  ['Make a mess of things.', '-'],
  ['Seldom feel blue.', '+'],
  ['Am not interested in abstract ideas.', '-'],
  ['Start conversations.', '+'],
  ["Am not interested in other people's problems.", '-'],
  ['Get chores done right away.', '+'],
  ['Am easily disturbed.', '-'],
  ['Have excellent ideas.', '+'],
  ['Have little to say.', '-'],
  ['Have a soft heart.', '+'],
  ['Often forget to put things back in their proper place.', '-'],
  ['Get upset easily.', '-'],
  ['Do not have a good imagination.', '-'],
  ['Talk to a lot of different people at parties.', '+'],
  ['Am not really interested in others.', '-'],
  ['Like order.', '+'],
  ['Change my mood a lot.', '-'],
  ['Am quick to understand things.', '+'],
  ["Don't like to draw attention to myself.", '-'],
  ['Take time out for others.', '+'],
  ['Shirk my duties.', '-'],
  ['Have frequent mood swings.', '-'],
  ['Use difficult words.', '+'],
  ["Don't mind being the center of attention.", '+'],
  ["Feel others' emotions.", '+'],
  ['Follow a schedule.', '+'],
  ['Get irritated easily.', '-'],
  ['Spend time reflecting on things.', '+'],
  ['Am quiet around strangers.', '-'],
  ['Make people feel at ease.', '+'],
  ['Am exacting in my work.', '+'],
  ['Often feel blue.', '-'],
  ['Am full of ideas.', '+'],
];

export const IPIP_ITEMS: readonly IpipItem[] = ITEMS.map(([text, key], index) => ({
  number: index + 1,
  text,
  factor: BIG_FIVE_FACTORS[index % 5],
  keyed: key === '+' ? 'plus' : 'minus',
}));

export const IPIP_ITEM_COUNT = IPIP_ITEMS.length;

/** The five answers, 1 to 5, as the IPIP words them. */
export const IPIP_SCALE = [
  { value: 1, label: 'Very inaccurate' },
  { value: 2, label: 'Moderately inaccurate' },
  { value: 3, label: 'Neither accurate nor inaccurate' },
  { value: 4, label: 'Moderately accurate' },
  { value: 5, label: 'Very accurate' },
] as const;

export type BigFiveScores = Record<BigFiveFactor, number>;

/** Whether `answers` is a full set: exactly 50 whole numbers from 1 to 5. */
export function isCompleteAnswers(answers: unknown): answers is number[] {
  return (
    Array.isArray(answers) &&
    answers.length === IPIP_ITEM_COUNT &&
    answers.every((a) => Number.isInteger(a) && a >= 1 && a <= 5)
  );
}

/** The five factor sums, 10 to 50 each. Throws on anything but a full set. */
export function scoreBigFive(answers: readonly number[]): BigFiveScores {
  if (!isCompleteAnswers(answers)) {
    throw new Error(`A Big Five result needs ${IPIP_ITEM_COUNT} answers from 1 to 5.`);
  }
  const scores: BigFiveScores = {
    extraversion: 0,
    agreeableness: 0,
    conscientiousness: 0,
    emotional_stability: 0,
    intellect: 0,
  };
  IPIP_ITEMS.forEach((item, index) => {
    const answer = answers[index];
    scores[item.factor] += item.keyed === 'plus' ? answer : 6 - answer;
  });
  return scores;
}

/** A factor sum as a share of its range, 0 to 100: 10 is 0, 30 is 50, 50 is 100. */
export function factorPercent(sum: number): number {
  return Math.round(((sum - 10) / 40) * 100);
}

/** How each factor is named on screen, and what its high end means. */
export const FACTOR_WORDS: Record<BigFiveFactor, { name: string; high: string; low: string }> = {
  extraversion: {
    name: 'Extraversion',
    high: 'outgoing, talkative, energised by people',
    low: 'reserved, quiet, energised by time alone',
  },
  agreeableness: {
    name: 'Agreeableness',
    high: 'warm, trusting, attentive to others',
    low: 'blunt, sceptical, guarded with others',
  },
  conscientiousness: {
    name: 'Conscientiousness',
    high: 'organised, prepared, follows through',
    low: 'flexible, spontaneous, less bound by plans',
  },
  emotional_stability: {
    name: 'Emotional stability',
    high: 'calm, even, slow to be upset',
    low: 'quick to worry, moods that shift',
  },
  intellect: {
    name: 'Intellect',
    high: 'curious, imaginative, drawn to ideas',
    low: 'practical, concrete, drawn to the familiar',
  },
};
