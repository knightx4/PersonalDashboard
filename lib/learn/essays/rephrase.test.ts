import { describe, expect, it } from 'vitest';
import { describeRephrase, REPHRASE_MAX, rephraseContext, rephraseProblem, usableRephrase } from './rephrase';

describe('rephraseProblem', () => {
  it('needs words, and no more than a few sentences', () => {
    expect(rephraseProblem('  ** ')).toMatch(/Select the words/);
    expect(rephraseProblem('a'.repeat(REPHRASE_MAX + 1))).toMatch(/Select less/);
    expect(rephraseProblem('A sentence.')).toBeNull();
  });
});

describe('usableRephrase', () => {
  it('keeps the selection’s own spaces and takes off quotation marks around the whole reply', () => {
    expect(usableRephrase('“Money keeps its value.”', ' Money holds value. ')).toBe(' Money keeps its value. ');
  });

  it('refuses commentary, the same text, an empty reply and a reply far longer than the selection', () => {
    expect(usableRephrase('Here is a clearer version: x', 'Some text.')).toBeNull();
    expect(usableRephrase('Some text.', 'Some text.')).toBeNull();
    expect(usableRephrase('  ', 'Some text.')).toBeNull();
    expect(usableRephrase('x'.repeat(400), 'Short.')).toBeNull();
  });
});

describe('rephraseContext and describeRephrase', () => {
  it('sends the text either side, cut at a line, and only the selection to reword', () => {
    const doc = `${'old line\n'.repeat(300)}Before it. Selected words. After it.\nNext line.`;
    const from = doc.indexOf('Selected');
    const { before, after } = rephraseContext(doc, from, from + 'Selected words.'.length);
    expect(before.startsWith('old line')).toBe(true);
    expect(before.endsWith('Before it. ')).toBe(true);
    expect(after).toBe(' After it.\nNext line.');
    const turn = describeRephrase({ claim: 'Money is odd.', reader: '', before, selection: ' Selected words. ', after });
    expect(turn).toContain('<selected>\nSelected words.\n</selected>');
    expect(turn).toContain("The essay's claim, in the writer's words: Money is odd.");
    expect(turn).not.toContain('Who it is for');
  });
});
