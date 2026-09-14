import { MAX_PASTE_CHARS } from '@/lib/learn/quiz/model';

/**
 * A file handed over to be quizzed on.
 *
 * #446 settled what that means: text and markdown, read as text and stored the
 * same way a paste is. Nothing new is installed, the material stays quotable,
 * and the questions, the marking and the source shown on the result all keep
 * working the way they already do -- every one of them assumes there is text.
 *
 * Pure, and no `server-only`: the form shows the same limits the server
 * enforces, and every rule here is worth a test without a request around it.
 *
 * The kind is decided here rather than trusted from the input's accept
 * attribute, which is a hint to a file chooser and nothing more. Three
 * questions, in the order that costs least: is the name one we take, is it
 * small enough to read, and is what came out actually text.
 */

/** What the file chooser offers, and what the server accepts. */
export const QUIZ_FILE_EXTENSIONS = ['.txt', '.text', '.md', '.markdown', '.mdown'] as const;

/** For the input's accept attribute. A hint to the chooser, never a check. */
export const QUIZ_FILE_ACCEPT = [...QUIZ_FILE_EXTENSIONS, 'text/plain', 'text/markdown'].join(',');

/** Said on screen when a file is refused for its kind. */
export const QUIZ_FILE_KINDS = 'Text and markdown files only — .txt or .md.';

/**
 * The most bytes a file may be, before it is read.
 *
 * A megabyte of text is well past the character cap already, so this is the
 * cheap guard that stops a video being decoded to find that out.
 */
export const MAX_QUIZ_FILE_BYTES = 1_000_000;

export type QuizFileRejection = 'kind' | 'too-big' | 'too-long' | 'not-text' | 'empty';

export type QuizFileRead =
  | { ok: true; text: string }
  | { ok: false; reason: QuizFileRejection };

/** Whether the name is one of the kinds #446 settled on. */
export function quizFileKindAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  return QUIZ_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * The text in a file, or why there is none to be had.
 *
 * Strict UTF-8, so a PDF renamed to .md is refused here rather than stored as
 * a page of replacement characters and quizzed on. A file over the character
 * cap is refused rather than truncated: half a document silently becomes
 * questions about the half that was kept.
 */
export function readQuizFile(input: {
  name: string;
  size: number;
  bytes: Uint8Array;
}): QuizFileRead {
  if (!quizFileKindAllowed(input.name)) return { ok: false, reason: 'kind' };
  if (input.size > MAX_QUIZ_FILE_BYTES) return { ok: false, reason: 'too-big' };

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    return { ok: false, reason: 'not-text' };
  }

  // A decoder that accepted it is not proof it is prose: a UTF-8-clean binary
  // is rare but a null byte in the middle of one is not.
  if (text.includes('\u0000')) return { ok: false, reason: 'not-text' };

  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > MAX_PASTE_CHARS) return { ok: false, reason: 'too-long' };

  return { ok: true, text: trimmed };
}

/** What to say on screen about a file that was refused. */
export function quizFileMessage(reason: QuizFileRejection, name: string): string {
  switch (reason) {
    case 'kind':
      return `${name} is not a kind this reads. ${QUIZ_FILE_KINDS}`;
    case 'too-big':
      return `${name} is too big to read. Files up to a megabyte.`;
    case 'too-long':
      return `${name} is longer than a quiz reads — ${MAX_PASTE_CHARS.toLocaleString()} characters. Paste the part you want to be asked about.`;
    case 'not-text':
      return `${name} is not text, whatever it is called. ${QUIZ_FILE_KINDS}`;
    case 'empty':
      return `${name} has nothing in it.`;
  }
}
