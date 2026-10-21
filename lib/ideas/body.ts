/**
 * What a session's idea has to say before it is filed (note 8e038483).
 *
 * The person could not tell what many of Dash's suggestions were about: a
 * bare title such as "Show what LinkedIn infers about you" names a feature
 * and says nothing of where it came from or why it would help. So an idea a
 * session files is a title line, a blank line, and a paragraph that says
 * what the idea is, where it came from (the step, note, run or file that
 * prompted it) and why it would be useful.
 *
 * Only the shape can be checked here: a paragraph under the title, long
 * enough to hold those three things. Whether it says them is the writer's
 * job, and the skills that file ideas say so. Ideas the person writes, or
 * asks Dash to file for them, are their own words and are not checked.
 */

/** The fewest characters the paragraph under the title may have. */
export const IDEA_DETAIL_MIN = 160;

/**
 * Why a session's idea body is not ready to file, or null when it is.
 *
 * The title is the first line; the detail is everything after the first
 * blank line under it.
 */
export function ideaDetailShortfall(body: string): string | null {
  const text = body.replace(/\r\n/g, '\n').trim();
  const gap = text.search(/\n\s*\n/);
  const detail = gap === -1 ? '' : text.slice(gap).trim();
  if (detail.length >= IDEA_DETAIL_MIN) return null;
  const title = text.split('\n')[0].trim();
  const has = detail.length === 0 ? 'has only a title' : `has ${detail.length} characters under its title`;
  return (
    `"${title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title}" ${has}. ` +
    `Under the title line and a blank line, say what the idea is, where it came from ` +
    `and why it would be useful, in at least ${IDEA_DETAIL_MIN} characters.`
  );
}
