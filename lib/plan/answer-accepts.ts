/**
 * Whether the person's answer to a critic stop takes the screens as they are.
 *
 * The stop ask ends "accept it as it is, or say what to change", and the
 * person mostly types the first half rather than pressing Accept: "It's
 * fine", "yes", "probably fine", "Accept". On 10 October a step answered all
 * three of those went back to not started with its work never merged,
 * because recording the accept was left to the next session and none did.
 * `answerBlockedStep` reads the answer with this and records the accept
 * itself when it says yes.
 *
 * The rule is narrow on purpose. Every word of the answer has to be one an
 * accept is made of, at least one of them has to say yes, and the answer has
 * to be short. A question mark, a word asking for a change ("make", "move",
 * "but", "bigger") or any word not on the list makes it false, and the words
 * go to the next session as before. A false reading costs a session reading
 * the answer; a true one merges the screens, so only the first is allowed to
 * be wrong.
 */

/** Longer than this and the answer is read as instructions, whatever it says. */
const MOST_WORDS = 14;

/** Words that say yes to the screens on their own. */
const YES = new Set([
  'accept',
  'accepted',
  'approve',
  'approved',
  'yes',
  'yeah',
  'yep',
  'ok',
  'okay',
  'sure',
  'fine',
  'good',
  'great',
  'perfect',
  'lgtm',
  'ship',
  'ahead',
  'continue',
  'alright',
  'know',
]);

/**
 * Words that may stand around a yes without changing it: "it's probably
 * fine", "looks good to me", "go ahead and ship it", "I'll let you know if
 * something comes up". Nothing here asks for anything.
 */
const AROUND = new Set([
  'it',
  "it's",
  'its',
  'is',
  'are',
  'that',
  "that's",
  'thats',
  'this',
  'these',
  'those',
  'them',
  'all',
  'the',
  'screen',
  'screens',
  'as',
  'probably',
  'think',
  'i',
  "i'm",
  "i'll",
  'ill',
  'look',
  'looks',
  'to',
  'me',
  'go',
  'and',
  'let',
  'you',
  'if',
  'something',
  'anything',
  'else',
  'comes',
  'up',
  'need',
  'now',
  'for',
  'just',
  'please',
  'thanks',
  'thank',
  'enough',
  'really',
  'very',
  'pretty',
  'quite',
  'seems',
  'by',
  'fair',
  'right',
  'there',
  'here',
  'with',
  'on',
]);

/**
 * Words that ask for something, refused even if one is later added to the
 * lists above by mistake. Today none of them is on those lists, so a word off
 * the lists is refused either way.
 */
export const ASKS_FOR_CHANGE = [
  'change',
  'make',
  'move',
  'fix',
  'remove',
  'add',
  'instead',
  'should',
  'but',
  'bigger',
  'smaller',
  'not',
  "don't",
  'no',
  'wait',
  'except',
  'only',
  'try',
  'redo',
  'again',
] as const;

const ASKING = new Set<string>(ASKS_FOR_CHANGE);

/** The answer's words, lower case, with curly apostrophes made straight. */
function words(answer: string): string[] {
  return answer
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/** True when the answer takes the screens as they are and asks for nothing. */
export function answerAccepts(answer: string | null | undefined): boolean {
  if (!answer) return false;
  // A question back is not an answer to the stop, whatever else it says.
  if (answer.includes('?')) return false;
  const said = words(answer);
  if (said.length === 0 || said.length > MOST_WORDS) return false;
  if (said.some((word) => ASKING.has(word))) return false;
  if (!said.every((word) => YES.has(word) || AROUND.has(word))) return false;
  return said.some((word) => YES.has(word));
}
