import { rowSubject, type TalkSubject, type TalkTurn } from '@/lib/talk/talk';
import type { NewsStory } from '@/lib/news/issues/stories';

/**
 * Discussing a Quick read story with Dash (plan #1060).
 *
 * The exchange is a saved conversation (lib/talk, plan #1053). A story is not
 * a row of its own: it is a position in the stories array on news.issues. But
 * discussing a story saves it (plan #1061), so the conversation is the row
 * thread under its saved copy, `news.saved_stories:<id>` (plan #1468), found
 * by issue and headline, the key saved_stories is unique on. The Quick read
 * sheet and the Saved tab therefore open the same thread.
 *
 * This file needs no database, so the sheet can import it.
 */

/** How many replies Dash gives before the discussion closes. */
export const DISCUSS_ROUNDS = 3;

/** The table a story's thread sits under. */
export const STORY_TABLE = 'news.saved_stories';

/** The saved story as a conversation subject, titled with its headline. */
export function storySubject(savedStoryId: string, headline: string): TalkSubject {
  return rowSubject(STORY_TABLE, savedStoryId, headline);
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
