import { createHash } from 'node:crypto';
import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  authorshipBlock,
  blockMarks,
  blockMatches,
  blockRanges,
  draftMarksJson,
  fileRanges,
  graphemeStarts,
  mapMarks,
  normaliseMarks,
  readAuthorshipBlock,
  readDraftMarks,
  relocateMarks,
  sha256Hex,
  stripAuthorshipBlock,
  toGrapheme,
  yourWords,
  type AuthorMark,
} from './authorship';

const dash = (from: number, to: number, name = 'claude-sonnet-5-5'): AuthorMark => ({ author: 'dash', from, to, name });

describe('sha256Hex', () => {
  it('matches node:crypto on ASCII, emoji, CRLF and a text past one block', () => {
    for (const text of ['', 'abc', 'Money is the universal pander. 🪙👩🏽‍🔬 café', 'a\r\nb\r\n', 'x'.repeat(1000)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('graphemes', () => {
  it('counts an emoji with modifiers and a CRLF as one grapheme each', () => {
    const text = 'a👩🏽‍🔬b\r\nc';
    expect(graphemeStarts(text)).toHaveLength(5);
    expect(toGrapheme(graphemeStarts(text), text.indexOf('b'))).toBe(2);
    expect(toGrapheme(graphemeStarts(text), text.length)).toBe(5);
  });
});

describe('the block', () => {
  const text = '---\ntitle: "Money"\n---\n\nMy sentence. Dash’s sentence. Mine again.';
  const from = text.indexOf('Dash’s');
  const to = from + 'Dash’s sentence.'.length;

  it('writes the header, the person, Dash and the closing line in the v0.2 format', () => {
    const { block, ranges } = authorshipBlock(text, [dash(from, to)], { self: 'Selvey' });
    const total = graphemeStarts(text).length;
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 32);
    expect(block.split('\n')).toEqual([
      '---',
      `Annotations: 0,${total} SHA-256 ${hash}`,
      `@Selvey: 0,${from} ${to},${total - to}`,
      `&Dash <claude-sonnet-5-5>: ${from},${to - from}`,
      '...',
    ]);
    expect(ranges).toEqual([
      { author: 'self', start: 0, length: from, name: '' },
      { author: 'dash', start: from, length: to - from, name: 'claude-sonnet-5-5' },
      { author: 'self', start: to, length: total - to, name: '' },
    ]);
  });

  it('reads back what it writes, as the Obsidian plugin reads it, and checks the hash', () => {
    const { block } = authorshipBlock(text, [dash(from, to)], { self: 'Selvey' });
    const file = `${text}\n\n${block}\n`;
    const read = readAuthorshipBlock(file)!;
    expect(read.text).toBe(text);
    expect(blockMatches(read)).toBe(true);
    expect(blockMarks(read)).toEqual([dash(from, to)]);
    expect(blockRanges(read).map((r) => r.author)).toEqual(['self', 'dash', 'self']);
    expect(stripAuthorshipBlock(file)).toBe(`${text}\n`);

    // The plugin's own patterns (rflpazini/obsidian-authorship, AnnotationParser.ts).
    const lines = block.split('\n');
    expect(lines[1]).toMatch(/^(\w+):\s*(\d+),(\d+)\s+SHA-256\s+([0-9a-fA-F]{20,64})\s*$/);
    for (const line of lines.slice(2, -1)) expect(line).toMatch(/^([@&*])\s*([^:]*?):\s*(.*)$/);
  });

  it('notices an edit made elsewhere', () => {
    const { block } = authorshipBlock(text, [dash(from, to)], { self: 'Selvey' });
    const edited = readAuthorshipBlock(`${text.replace('Mine again', 'Theirs')}\n\n${block}\n`)!;
    expect(blockMatches(edited)).toBe(false);
  });

  it('counts offsets in graphemes, so an emoji before Dash’s text moves it by one', () => {
    const emoji = `🪙 ${text}`;
    const at = emoji.indexOf('Dash’s');
    const { ranges } = authorshipBlock(emoji, [dash(at, at + 6)], { self: 'Self' });
    expect(ranges[1]).toMatchObject({ author: 'dash', start: at - 1, length: 6 });
  });

  it('keeps colons and angle brackets out of a quote’s name and leaves files with no block alone', () => {
    const quote: AuthorMark = { author: 'quote', from: 0, to: 3, name: 'Walzer: Spheres <ch4>' };
    expect(authorshipBlock('abcdef', [quote], { self: 'Self' }).block).toContain('*Walzer - Spheres ch4: 0,3');
    expect(readAuthorshipBlock('# Title\n\n---\n\nNo block here.\n')).toBeNull();
    expect(stripAuthorshipBlock('plain\n')).toBe('plain\n');
  });

  it('gives the person the whole text when nothing is marked', () => {
    expect(fileRanges('hello', [])).toEqual([{ author: 'self', start: 0, length: 5, name: '' }]);
  });
});

describe('marks', () => {
  it('join touching runs and drop what is outside the text', () => {
    expect(normaliseMarks([dash(5, 9), dash(0, 5), dash(20, 30)], 12)).toEqual([dash(0, 9)]);
  });

  it('read back from draft_authorship, leaving out anything malformed', () => {
    const json = [...draftMarksJson([dash(2, 6)]), { author: 'someone', start: 0, length: 1 }, { author: 'dash', start: 9, length: 50 }];
    expect(readDraftMarks(json, 20)).toEqual([dash(2, 6)]);
  });

  it('split around text the person types inside Dash’s run', () => {
    const changes = ChangeSet.of({ from: 5, insert: 'mine' }, 20);
    expect(mapMarks([dash(2, 10)], changes)).toEqual([dash(2, 5), dash(9, 14)]);
  });

  it('go with the text a change removes, and mark inserted text as Dash’s only when told', () => {
    const changes = ChangeSet.of({ from: 0, to: 4, insert: 'xy' }, 20);
    expect(mapMarks([dash(2, 6)], changes)).toEqual([dash(2, 4)]);
    expect(mapMarks([], changes, { author: 'dash', name: 'm' })).toEqual([dash(0, 2, 'm')]);
  });

  it('move onto a new version of the text by their words', () => {
    const old = 'Mine. Dash said this. Mine.';
    const at = old.indexOf('Dash said this.');
    const next = 'A new opening line. Mine. Dash said this. Mine.';
    expect(relocateMarks(old, [dash(at, at + 15)], next)).toEqual([dash(next.indexOf('Dash'), next.indexOf('Dash') + 15)]);
    expect(relocateMarks(old, [dash(at, at + 15)], 'All rewritten.')).toEqual([]);
  });
});

describe('yourWords', () => {
  it('is the person’s letters and digits out of theirs and Dash’s, quotes and symbols left out', () => {
    const text = '# Abc\n\n**de** fg "hij"';
    const fg = text.indexOf('fg');
    const quote = text.indexOf('"hij"');
    const result = yourWords(text, [dash(fg, fg + 2), { author: 'quote', from: quote, to: quote + 5, name: 'Walzer' }]);
    expect(result).toEqual({ yours: 5, dash: 2, percent: 71 });
  });

  it('is 100 with no Dash text, never rounds up to 100 with some, and is null on an empty draft', () => {
    expect(yourWords('all mine', []).percent).toBe(100);
    expect(yourWords(`${'a'.repeat(999)}b`, [dash(999, 1000)]).percent).toBe(99);
    expect(yourWords('  # ', []).percent).toBeNull();
  });
});
