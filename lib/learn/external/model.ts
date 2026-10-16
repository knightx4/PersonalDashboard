/**
 * An external item set (plan #2179.4): published questions neither the person
 * nor the app wrote, answered once and scored, as an anchor to compare lens
 * progress against later. Pure shapes and rules; the reads and writes are in
 * store.ts.
 */

/** Most items one set may hold. A published set is about thirty. */
export const MAX_ITEMS = 100;

export type ExternalItem = {
  question: string;
  /** The answer the publisher gave. */
  expected: string;
  /** What was written; null until the item is answered, empty when passed. */
  response: string | null;
  /** How it was marked; null until answered. */
  correct: boolean | null;
};

export type ExternalCheck = {
  id: string;
  name: string;
  items: ExternalItem[];
  correctCount: number | null;
  scoredAt: string | null;
  createdAt: string;
  /** Read back with the row, so a write can refuse to land on a row that moved. */
  updatedAt: string;
};

export type ExternalCheckListItem = {
  id: string;
  name: string;
  total: number;
  answered: number;
  correctCount: number | null;
  /** When it was scored, or started if it has not been. */
  on: string;
  scored: boolean;
};

/** The index of the item to serve next, or null when every item is answered. */
export function nextItemIndex(items: readonly ExternalItem[]): number | null {
  const index = items.findIndex((item) => item.correct === null);
  return index === -1 ? null : index;
}

export function answeredCount(items: readonly ExternalItem[]): number {
  return items.filter((item) => item.correct !== null).length;
}

export function correctTotal(items: readonly ExternalItem[]): number {
  return items.filter((item) => item.correct === true).length;
}

/** "21 of 30", the way a score is said everywhere it appears. */
export function scoreLine(correct: number, total: number): string {
  return `${correct} of ${total}`;
}

/** Whole-number percent, for the figure beside the line. */
export function scorePercent(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

export type ParsedSet = { ok: true; items: ExternalItem[] } | { ok: false; error: string };

/**
 * Read a pasted set. One item per line, the question and its answer separated
 * by a tab (what a spreadsheet gives) or by " | ". A line with neither is
 * refused by number, since a question swallowed into the line above it would
 * shift every answer after it. Blank lines are skipped.
 */
export function parseSet(text: string): ParsedSet {
  const items: ExternalItem[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (!line) continue;
    const at = line.includes('\t') ? line.indexOf('\t') : line.indexOf(' | ');
    if (at === -1) {
      return {
        ok: false,
        error: `Line ${i + 1} has no answer. Put a tab or " | " between the question and its answer.`,
      };
    }
    const question = line.slice(0, at).trim();
    const expected = line.slice(at).replace(/^\t| \| /, '').trim();
    if (!question || !expected) {
      return { ok: false, error: `Line ${i + 1} is missing its ${question ? 'answer' : 'question'}.` };
    }
    items.push({ question, expected, response: null, correct: null });
  }
  if (items.length === 0) return { ok: false, error: 'Paste at least one question and its answer.' };
  if (items.length > MAX_ITEMS) {
    return { ok: false, error: `That is ${items.length} items. A set holds at most ${MAX_ITEMS}.` };
  }
  return { ok: true, items };
}
