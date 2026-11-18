/**
 * The spoken version of a chat bubble (plan #3079).
 *
 * Read word for word, a bot's bubble was hard to follow by ear: step outlines
 * like "#3050.3.2", counts, ISO dates and long lists all went to the voice.
 * So each bubble is rewritten once into what a person would say out loud,
 * one or two short sentences, and that is what Fish Audio is sent. The
 * bubble on screen never changes.
 *
 * - `SPOKEN_SCRIPT_SYSTEM` is what Haiku is told (script-model.ts makes the
 *   call).
 * - `scrubSpoken` is run over whatever comes back, so an outline, an address,
 *   a file path, a list marker or an emoji the model let through is still
 *   never read out.
 * - `plainEnough` spares a short plain bubble ("On it, I'll tell you when
 *   it's done.") the call: it is already speech.
 * - `spokenFor` puts them in order: the script kept on the bubble, else a new
 *   one written and kept, else the bubble itself, cleaned as before
 *   (text.ts), so voice never goes silent because a rewrite failed.
 */

import { asSentences, plainSpeech, SPEAK_CHAR_LIMIT, trimForSpeech } from '@/lib/talk/speech/text';

/** The longest bubble the model is shown; past this the head carries the gist. */
export const SCRIPT_INPUT_MAX = 6_000;

/** A bubble this short with nothing hard to hear in it is spoken as it is. */
const PLAIN_CHARS = 160;

export const SPOKEN_SCRIPT_SYSTEM = `You turn one chat message into what its writer would say if they said it out loud to a friend. The words you write are read aloud by a text-to-speech voice; nobody sees them.

Rules:
- Short and conversational: one or two sentences, three at most for a long message. Speak as the writer, in the first person, in the same mood.
- Collapse a list into how many there are and the gist: "four things need you, mainly setup keys and a phone test", never each item in turn.
- Never say a step number, outline, id, ref, hash or version, such as "#3050.3.2", "plan #12" or "a1b2c3d". If a step has to be named, use a few words of what it is ("the file-attach step"), or leave it out.
- Round numbers and say them simply: "about thirty", "around two hundred dollars", "a few".
- Say dates the way people do: "yesterday", "on Friday", "next week". Leave out times of day unless the time is the point.
- No web addresses, file paths, code, commands, markdown, emoji, brackets or asides in parentheses. If the message holds code or a command, say something like "I put the command in the message".
- Keep the meaning and anything the reader has to do or decide. Never add a fact, a promise or an opinion the message does not have.

Reply with the spoken words alone: no quotation marks, no preface, no notes.`;

/** The user turn: today, so "yesterday" can be said, and the message. */
export function spokenScriptMessage(bubble: string, today: string): string {
  return `Today is ${today}.\n\nThe message:\n\n${bubble.slice(0, SCRIPT_INPUT_MAX)}`;
}

/** A plan step's outline, and the word "plan" that leads into one: `#3050.3.2`, `plan #12`. */
const OUTLINE = /(?:\bplan\s+)?#\d+(?:\.\d+)*\b/gi;
/**
 * A file path, a page's path or a file's name: `lib/talk/speech/text.ts`,
 * `./scripts/sql.ts`, `/dev/plan`, `route.ts`. Two words with one slash
 * between them ("and/or") are left alone.
 */
const FILE_PATH =
  /(?:\.{1,2}\/)?\b(?:[\w.[\]-]+\/)+[\w.[\]-]+\.\w{1,5}\b|\b[\w.-]+(?:\/[\w.[\]-]+){2,}|(?<![\w/])\/[a-z][\w-]*(?:\/[\w.[\]-]+)*|\b[\w-]+\.(?:tsx?|jsx?|mjs|sql|md|json|ya?ml|sh|py|css|html)\b/g;
/** A uuid, or a hash of seven or more hex characters that has both a digit and a letter. */
const HEX_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
/** Where something was taken out, so a word left leading into nothing can go too. */
const GAP = '\u0000';
const LED_INTO = /\s*\b(?:in|at|on|of|to|for|from|with|via|see|under|by)[ \t]*(?=\u0000)/gi;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * What may be read aloud of `text`: markdown, code, addresses and refs out
 * as text.ts takes them, then outlines, file paths, ids, emoji and
 * parentheticals, each list item or line made a sentence, cut to `limit`.
 * Empty when nothing worth saying is left.
 */
export function scrubSpoken(text: string, limit: number = SPEAK_CHAR_LIMIT): string {
  // Outlines first: plainSpeech takes every # off, which would leave the number.
  let plain = plainSpeech(text.replace(OUTLINE, GAP));
  plain = plain.replace(/^\s*["“”']+|["“”']+\s*$/g, '');
  plain = plain.replace(EMOJI, '');
  // A parenthetical is an aside, and often only an outline or an address.
  for (let i = 0; i < 3; i += 1) plain = plain.replace(/\s*\([^()]*\)/g, '');
  plain = plain.replace(/\s*\[[^\]]*\]/g, '');
  plain = plain.replace(FILE_PATH, GAP);
  plain = plain.replace(HEX_ID, GAP);
  // A word that only led into what was taken out goes with it: "closed in a1b2c3d".
  plain = plain.replace(LED_INTO, '').replace(/\u0000/g, '');
  const lines = plain.split('\n').map((line) =>
    line
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
      .replace(/^[\s,;:.–—-]+/, '')
      .replace(/[\s,;:–—-]+([.!?])$/, '$1')
      .replace(/[\s,;:–—-]+$/, '')
      .trim(),
  );
  return trimForSpeech(asSentences(lines.join('\n')), limit).text;
}

/**
 * Whether a bubble can be spoken as it is: one short line with no number,
 * outline, address, list or code in it, which a rewrite could only repeat.
 */
export function plainEnough(bubble: string): boolean {
  if (/[\d#`|]|https?:|www\.|\n\s*([-*+]|\d+[.)])\s/.test(bubble)) return false;
  const plain = plainSpeech(bubble);
  return !plain.includes('\n') && Array.from(plain).length <= PLAIN_CHARS;
}

export type SpokenSource = 'kept' | 'plain' | 'written' | 'fallback';

export type SpokenDeps = {
  /** The script already kept on this bubble; null when none was, or the bubble is no row of theirs. */
  kept: () => Promise<string | null>;
  /** The model's spoken version of the bubble; null when the call failed or timed out. Never throws. */
  write: (bubble: string) => Promise<string | null>;
  /** Keeps a script on the bubble, for the next hearing. Never throws. */
  keep: (script: string) => Promise<void>;
  limit?: number;
};

/**
 * The words to speak for one bubble, and where they came from: the kept
 * script, the bubble itself when it is plain enough, a new script (kept for
 * next time), or, when the rewrite fails or says nothing, the bubble as
 * before, which speakReply cleans and cuts as it always has.
 */
export async function spokenFor(bubble: string, deps: SpokenDeps): Promise<{ text: string; source: SpokenSource }> {
  const limit = deps.limit ?? SPEAK_CHAR_LIMIT;
  let kept: string | null = null;
  try {
    kept = await deps.kept();
  } catch (error) {
    console.error('[speech] kept script not read', error instanceof Error ? error.message : error);
  }
  if (kept?.trim()) return { text: kept, source: 'kept' };

  if (plainEnough(bubble)) {
    const plain = scrubSpoken(bubble, limit);
    if (plain) {
      await deps.keep(plain);
      return { text: plain, source: 'plain' };
    }
  }

  let written: string | null = null;
  try {
    written = await deps.write(bubble);
  } catch (error) {
    console.error('[speech] script not written', error instanceof Error ? error.message : error);
  }
  const script = written ? scrubSpoken(written, limit) : '';
  if (!script) return { text: bubble, source: 'fallback' };
  await deps.keep(script);
  return { text: script, source: 'written' };
}
