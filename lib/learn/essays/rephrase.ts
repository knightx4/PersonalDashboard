/**
 * Rephrase, rung 4 of the ladder (docs/LEARN-ESSAYS-SPEC.md, "What Dash
 * does, and how far it goes"; plan #1868).
 *
 * The person selects some text and asks; Dash answers with one rewording of
 * that text and nothing else, which the editor shows as a change to accept
 * or reject. These are the rules for what is sent and what comes back.
 * Pure, so tested.
 */

/** The longest selection Rephrase takes: a few sentences, never a section. */
export const REPHRASE_MAX = 1_200;

/** How much of the essay either side of the selection goes with it. */
const BEFORE = 1_200;
const AFTER = 600;

/** What is wrong with a selection, or null when Rephrase can take it. */
export function rephraseProblem(selection: string): string | null {
  if (!/[\p{L}\p{N}]/u.test(selection)) return 'Select the words you want reworded first.';
  if (selection.length > REPHRASE_MAX) {
    return 'Rephrase takes a sentence or a few at a time. Select less and try again.';
  }
  return null;
}

/** The text around the selection, cut at a line where it can be, as the model reads it. */
export function rephraseContext(doc: string, from: number, to: number): { before: string; after: string } {
  let start = Math.max(0, from - BEFORE);
  if (start > 0) {
    const line = doc.indexOf('\n', start);
    if (line >= 0 && line < from) start = line + 1;
  }
  let end = Math.min(doc.length, to + AFTER);
  if (end < doc.length) {
    const line = doc.lastIndexOf('\n', end);
    if (line > to) end = line;
  }
  return { before: doc.slice(start, from), after: doc.slice(to, end) };
}

/**
 * Dash's reply as the replacement text, or null when it is not one: empty,
 * the same as what was selected, wrapped in commentary, or far longer than
 * the selection. Quotation marks around the whole reply are taken off, and
 * the selection's own leading and trailing space is kept, so accepting it
 * does not join two words.
 */
export function usableRephrase(reply: string, selection: string): string | null {
  let text = reply.trim();
  const pairs: [string, string][] = [['"', '"'], ['“', '”'], ["'", "'"], ['‘', '’']];
  for (const [open, close] of pairs) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close) && !selection.trim().startsWith(open)) {
      text = text.slice(open.length, text.length - close.length).trim();
    }
  }
  if (!text) return null;
  if (/^(here is|here's|sure|certainly|rephrased|suggestion)\b/i.test(text)) return null;
  const core = selection.trim();
  if (text === core) return null;
  if (text.length > core.length * 3 + 200) return null;
  const lead = selection.match(/^\s*/)![0];
  const trail = selection.match(/\s*$/)![0];
  return `${lead}${text}${trail}`;
}

/** The user turn: the brief's claim and reader, the text around, and the selection to reword. */
export function describeRephrase(input: {
  claim: string;
  reader: string;
  before: string;
  selection: string;
  after: string;
}): string {
  const parts: string[] = [];
  if (input.claim.trim()) parts.push(`The essay's claim, in the writer's words: ${input.claim.trim()}`);
  if (input.reader.trim()) parts.push(`Who it is for: ${input.reader.trim()}`);
  parts.push(`<before>\n${input.before}\n</before>`);
  parts.push(`<selected>\n${input.selection.trim()}\n</selected>`);
  parts.push(`<after>\n${input.after}\n</after>`);
  parts.push('Reword the selected text only.');
  return parts.join('\n\n');
}
