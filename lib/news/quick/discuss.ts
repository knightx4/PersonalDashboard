import type { TalkSubject, TalkTurn } from '@/lib/talk/talk';
import type { NewsStory } from '@/lib/news/issues/stories';

/**
 * Discussing a Quick read story with Dash (plan #1060).
 *
 * The exchange is a saved conversation (lib/talk, plan #1053) whose subject is
 * the story. A story is not a row of its own: it is a position in the stories
 * array on news.issues, which is how saved_stories and story_passes name one
 * too. So the conversation's ref is the issue id and the story index, joined
 * by a colon, the same key reactionKey in reactions.ts uses.
 *
 * Re-summarising a newsletter rewrites that array, so an index can later name
 * another story. The conversation keeps the headline it began with as its
 * title (core.conversations.title), which is what to show when the two
 * disagree.
 *
 * This file needs no database, so the sheet can import it.
 */

/** How many replies Dash gives before the discussion closes. */
export const DISCUSS_ROUNDS = 3;

/** The conversation's subject_ref for a story: `<issue id>:<story index>`. */
export function storyRef(issueId: string, storyIndex: number): string {
  return `${issueId}:${storyIndex}`;
}

/** The story as a conversation subject, titled with its headline. */
export function storySubject(issueId: string, storyIndex: number, headline: string): TalkSubject {
  return { kind: 'news_story', ref: storyRef(issueId, storyIndex), title: headline };
}

/**
 * The story as Dash reads it: the summary and the story's own text from the
 * newsletter. Not the linked article, which would mean a fetch per press.
 */
export function storyMaterial(story: Pick<NewsStory, 'summary' | 'text'>): string {
  return [story.summary, story.text].filter((part) => part?.trim()).join('\n\n');
}

/** How many replies Dash has given in the thread. */
export function roundsTaken(turns: readonly Pick<TalkTurn, 'role'>[]): number {
  return turns.filter((turn) => turn.role === 'assistant').length;
}

/** Whether the discussion has had its rounds, so there is nothing more to send. */
export function discussionClosed(turns: readonly Pick<TalkTurn, 'role'>[]): boolean {
  return roundsTaken(turns) >= DISCUSS_ROUNDS;
}

const STANCE = `THIS EXCHANGE IS A DISCUSSION, NOT A LESSON. The person is saying what they
make of a news story. Do not tell them what to think and do not agree for the
sake of it. Each reply does one of two things: argue the strongest reading of
the story that runs against theirs, or ask what their view depends on. One
point per reply, in a few sentences.

Keep to what the story says. Where a point needs facts the story does not
give, say that it does rather than supplying them as settled.`;

/**
 * What Dash is told for the reply it is about to give, the first being 1.
 * The last round asks nothing new and closes the discussion with one line on
 * where their view held and where it was thin.
 */
export function discussGuidance(round: number): string {
  if (round < DISCUSS_ROUNDS) {
    return `${STANCE}\n\nEnd with one pointed question for them to answer.`;
  }
  return `${STANCE}

THIS IS THE LAST REPLY. Answer their point in a sentence or two and ask no new
question. Then close with one line on its own, starting "Where your view
stands:", saying where it held up and where it was thin.`;
}
