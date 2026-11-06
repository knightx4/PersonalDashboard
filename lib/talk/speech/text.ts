/**
 * What of a chat reply is read aloud (plan #3006.3).
 *
 * Fish Audio bills every UTF-8 byte it is sent, so a reply is cut down before
 * it goes: code blocks, pictures, links' addresses, bare web addresses, row
 * refs, citation marks and HTML are dropped, markdown's marks are taken off
 * the words they wrap, and what is left is cut to SPEAK_CHAR_LIMIT characters
 * at the last sentence that fits. The reply on screen is never changed; this
 * is only the text sent to be spoken.
 */

/** The most characters of one reply that are spoken: about a minute of speech. */
export const SPEAK_CHAR_LIMIT = 600;

/** What prepareSpeech hands back: the words to speak, what Fish bills for them, and whether the reply was cut. */
export type SpeechText = {
  text: string;
  bytes: number;
  trimmed: boolean;
};

const encoder = new TextEncoder();

/** UTF-8 bytes, which is what Fish bills by. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** A row ref as Dash writes one: `todo.tasks:3f2a…` or `tasks:3f2a…`. */
const ROW_REF = /\b(?:[a-z_]+\.)?[a-z_]+:[0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}\b/gi;

/**
 * Markdown and the rest taken out of a reply, one line per paragraph or list
 * item. Exported for the tests; prepareSpeech is what callers use.
 */
export function plainSpeech(reply: string): string {
  let text = reply.replace(/\r\n?/g, '\n');

  // Whole blocks that are never read: fenced code and HTML comments.
  text = text.replace(/```[\s\S]*?(?:```|$)/g, '\n');
  text = text.replace(/~~~[\s\S]*?(?:~~~|$)/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Pictures go; a link keeps its words and loses its address.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1');
  text = text.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  // Reference definitions at the foot: `[1]: https://…`.
  text = text.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '');
  // Citation marks: [1], [^2], [1, 3], 【4】, and a bare footnote ref.
  text = text.replace(/\[\^?\d+(?:\s*[,–-]\s*\^?\d+)*\]/g, '');
  text = text.replace(/【[^】]*】/g, '');
  // Bare addresses and row refs.
  // A sentence's own mark after an address stays.
  const keepEnd = (address: string) => /[.,;:!?]+$/.exec(address.replace(/>$/, ''))?.[0] ?? '';
  text = text.replace(/<?\bhttps?:\/\/[^\s<>)\]]+>?/gi, keepEnd);
  text = text.replace(/\bwww\.[^\s<>)\]]+/gi, keepEnd);
  text = text.replace(ROW_REF, '');
  // HTML tags, keeping what they wrap.
  text = text.replace(/<\/?[a-z][^>]*>/gi, ' ');

  const lines = text.split('\n').flatMap((raw) => {
    let line = raw.trim();
    if (!line) return [''];
    // Rules and a table's divider row.
    if (/^([-*_]\s*){3,}$/.test(line)) return [''];
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line)) return [];
    line = line.replace(/^#{1,6}\s+/, '');
    line = line.replace(/^(>\s*)+/, '');
    line = line.replace(/^([-*+]|\d{1,3}[.)])\s+/, '');
    line = line.replace(/^\[[ xX]\]\s+/, '');
    // A table row reads as its cells in turn.
    if (line.includes('|')) {
      line = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(', ');
    }
    // Emphasis and inline code keep their words.
    line = line.replace(/`([^`]*)`/g, '$1');
    line = line.replace(/(\*\*|__)(.+?)\1/g, '$2');
    line = line.replace(/~~(.+?)~~/g, '$1');
    line = line.replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2');
    line = line.replace(/[*`#~]+/g, ' ');
    line = line.replace(/\s+([.,;:!?])/g, '$1');
    line = line.replace(/\(\s*\)/g, '');
    return [line.replace(/\s{2,}/g, ' ').trim()];
  });

  return lines
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim();
}

/** Lines become sentences: one with no closing mark of its own gets a full stop, so a list is read as a list. */
function asSentences(plain: string): string {
  return plain
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .map((line) => (/[.!?:;…]["')\]]?$/.test(line) ? line : `${line}.`))
    .join(' ');
}

/** Cut to `limit` characters at the last sentence that fits, else the last word, never mid-word. */
export function trimForSpeech(text: string, limit: number = SPEAK_CHAR_LIMIT): { text: string; trimmed: boolean } {
  const chars = Array.from(text);
  if (chars.length <= limit) return { text, trimmed: false };
  const head = chars.slice(0, limit).join('');
  const lastSentence = Math.max(...['. ', '! ', '? ', '… '].map((end) => head.lastIndexOf(end)));
  if (lastSentence >= limit / 2) return { text: head.slice(0, lastSentence + 1).trim(), trimmed: true };
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return { text: `${cut.replace(/[\s,;:–-]+$/, '')}…`, trimmed: true };
}

/** The words of a reply to send to be spoken, cut to the limit, with the bytes Fish will bill. */
export function prepareSpeech(reply: string, limit: number = SPEAK_CHAR_LIMIT): SpeechText {
  const { text, trimmed } = trimForSpeech(asSentences(plainSpeech(reply)), limit);
  return { text, bytes: utf8Bytes(text), trimmed };
}
