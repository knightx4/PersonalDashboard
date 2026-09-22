import { describe, expect, it } from 'vitest';
import { chunkNote, cutLong, MAX_NOTE_READ_CHARS, NOTE_SECTION_CHARS } from './note-chunks';

const squash = (text: string) => text.replace(/\s+/g, '');

const para = (i: number, length = 900) => `${'word '.repeat(length / 5 - 2)}p${i}.`;

/** Every non-space character of the note, in order, across the chunks. */
function coversAll(body: string) {
  const { chunks, skipped } = chunkNote(body);
  expect(skipped).toEqual([]);
  expect(squash(chunks.map((c) => c.text).join(''))).toBe(squash(body));
  for (const c of chunks) expect(body.slice(c.start, c.end)).toBe(c.text);
}

describe('reading a note end to end', () => {
  it('reads every section of a note with far more than ten', () => {
    const body = Array.from({ length: 219 }, (_, i) => `## Topic ${i}\n\n${para(i, 1200)}`).join(
      '\n\n',
    );
    const { chunks, readChars, chars } = chunkNote(body);
    expect(chunks.length).toBe(219);
    expect(chunks.at(-1)!.title).toBe('Topic 218');
    expect(readChars).toBeGreaterThan(chars * 0.95);
    coversAll(body);
  });

  it('keeps what comes before the first heading', () => {
    const body = `${para(1, 600)}\n\n${para(2, 600)}\n\n# Later\n\n${para(3, 600)}`;
    const { chunks } = chunkNote(body);
    expect(chunks[0]!.text).toContain('p1.');
    expect(chunks[0]!.text).toContain('p2.');
    expect(chunks[1]!.title).toBe('Later');
    coversAll(body);
  });

  it('cuts one enormous block rather than passing it whole', () => {
    const transcript = Array.from({ length: 600 }, (_, i) => `Speaker says thing ${i}.`).join(' ');
    const body = `# Transcript\n\n${transcript}`;
    const { chunks } = chunkNote(body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(NOTE_SECTION_CHARS);
    // Cut at sentence ends, not mid-word.
    for (const c of chunks.slice(0, -1)) expect(c.text.endsWith('.')).toBe(true);
    expect(chunks[1]!.title).toBe('Transcript (continued)');
    coversAll(body);
  });

  it('cuts at paragraph breaks when there are any', () => {
    const body = Array.from({ length: 10 }, (_, i) => para(i)).join('\n\n');
    const { chunks } = chunkNote(body);
    for (const c of chunks) expect(c.text).toMatch(/p\d+\.$/);
    coversAll(body);
  });

  it('folds a short section into its neighbour, named by the one with substance', () => {
    const body = `# Contents\n\n# The argument\n\n${para(1, 600)}\n\n# Aside\n\nshort.`;
    const { chunks } = chunkNote(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.title).toBe('The argument');
    coversAll(body);
  });

  it('does not cut on a hash inside fenced code', () => {
    const body = `# Setup\n\n${para(1, 400)}\n\n\`\`\`sh\n# not a heading\necho hi\n\`\`\`\n\n# Next\n\n${para(2, 400)}`;
    expect(chunkNote(body).chunks.map((c) => c.title)).toEqual(['Setup', 'Next']);
  });

  it('returns nothing for an empty note, and skips nothing', () => {
    expect(chunkNote('  \n\n ')).toEqual({ chunks: [], chars: 5, readChars: 0, skipped: [] });
  });
});

describe('what is past the read limit', () => {
  it('is recorded against the note, from where reading stopped', () => {
    const body = Array.from({ length: 10 }, (_, i) => `# S${i}\n\n${para(i, 1000)}`).join('\n\n');
    const { chunks, skipped } = chunkNote(body, { maxReadChars: 3500 });
    expect(chunks.map((c) => c.title)).toEqual(['S0', 'S1', 'S2']);
    expect(skipped).toHaveLength(1);
    const [skip] = skipped;
    expect(skip).toMatchObject({ reason: 'read-cap', chunks: 7, from: 'S3', end: body.length });
    expect(body.slice(skip!.start)).toMatch(/^# S3/);
    expect(skip!.chars).toBe(body.length - skip!.start);
    expect(skip!.detail).toContain('S3');
  });

  it('is far above the largest note in the vault', () => {
    expect(MAX_NOTE_READ_CHARS).toBeGreaterThan(302_851);
  });
});

describe('cutLong', () => {
  it('never cuts a piece above the size or below half of it, save the last', () => {
    const text = 'x'.repeat(10_050);
    const pieces = cutLong(text, 0, text.length, 1000);
    expect(pieces.map(([s, e]) => e - s)).toEqual([...Array(10).fill(1000), 50]);
  });

  it('does not split a surrogate pair on a hard cut', () => {
    const text = `${'x'.repeat(999)}😀${'x'.repeat(500)}`;
    const [[, end]] = cutLong(text, 0, text.length, 1000);
    expect(end).toBe(999);
  });
});
