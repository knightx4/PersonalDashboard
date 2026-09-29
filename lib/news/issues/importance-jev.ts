import type { JevState } from '@/lib/jev/client';
import type { Unrated } from './importance-rows';

/**
 * A story's importance as one Jev score question (plan #1170).
 *
 * importance.ts asks Haiku to rate every unrated story of a newsletter in one
 * call, against the rubric in importance-rubric.ts. Jev rates one story at a
 * time on five levels, each worded from what the rubric says that rating
 * means, and says how sure it is. A story Jev is at least 0.8 sure of keeps
 * Jev's rating; the rest of the newsletter goes to Haiku in one call as
 * before.
 */

/**
 * Whether the catch-up asks Jev at all. An account also has to have opted in
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

/** Jev's level index, 0 to 4, as the rating stored on the story, 1 to 5. */
export function ratingFromLevel(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level) + 1));
}
