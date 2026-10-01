import type { JevState } from '@/lib/jev/client';
import type { Unrated } from './importance-rows';

/**
 * A story's importance as one Jev score question (plan #1170).
 *
 * Jev rates one story at a time on five levels, each worded from what the
 * rubric in importance-rubric.ts says that level means. Its answer carries a
 * score weighted by how likely it finds each level, which can fall between
 * two levels; that score, spread over 0 to 100, is the story's rating.
 *
 * Every answer Jev gives is used, whatever its confidence. The trial
 * (docs/trials/2026-10-01-jev-news-importance.md) found Jev the better judge
 * where it and Haiku disagreed, but sure of only 264 of 828 stories at the
 * usual 0.8 floor: on five levels its belief spreads over neighbouring ones.
 * The weighted score already reflects that spread, and a story ranked a few
 * places off costs little. Haiku rates only the stories Jev could not answer.
 */

/**
 * Whether stories are put to Jev at all. An account also has to have opted in
 * (lib/jev/enabled.ts). Setting this to false puts every account back on
 * Haiku alone.
 */
export const IMPORTANCE_ON_JEV = true;

export const IMPORTANCE_QUESTION = {
  type: 'score',
  question:
    'This is one story from an email newsletter: its topic, headline and a short summary. How much does a well-informed general reader need to know it? Judge the event itself, not how prominently the newsletter places it or how it is written. Most stories are 2 or 3; 5 is for the few a reader would be embarrassed to have missed.',
  levels: [
    '1: A light item: trivia, a quiz, lifestyle filler, a joke, a recommendation, a promotion, or anything about the newsletter itself.',
    '2: Minor news: an incremental update, a niche item, a small product launch, a personal finance or career tip.',
    '3: Solid news of moderate consequence, or of real interest within its field.',
    "4: A significant development with real consequences for many people or for a whole field, such as a major policy decision, a large company's results or deal, or an important scientific finding.",
    '5: Major news of wide consequence, the kind that leads front pages: a war or attack, an election result, a landmark court ruling or law, a market-moving event, a disaster, the death of a head of state.',
  ],
} as const;

export function storyState(story: Unrated): JevState {
  return { topic: story.topic ?? 'no topic', headline: story.headline, summary: story.summary };
}

/** Jev's weighted score, 0 to 4, as the rating stored on the story, 0 to 100. */
export function ratingFromScore(score: number): number {
  const levels = IMPORTANCE_QUESTION.levels.length - 1;
  return Math.min(100, Math.max(0, Math.round((score / levels) * 100)));
}

/** A Haiku rating from 1 to 5 on the same scale: 1 is 0, 3 is 50, 5 is 100. */
export function ratingFromHaiku(importance: number): number {
  return Math.min(100, Math.max(0, Math.round((importance - 1) * 25)));
}
