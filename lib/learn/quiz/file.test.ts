import { describe, expect, it } from 'vitest';
import { MAX_PASTE_CHARS } from '@/lib/learn/quiz/model';
import { MAX_QUIZ_FILE_BYTES, quizFileKindAllowed, readQuizFile } from '@/lib/learn/quiz/file';

const bytesOf = (text: string) => new TextEncoder().encode(text);

function read(name: string, text: string) {
  const bytes = bytesOf(text);
  return readQuizFile({ name, size: bytes.byteLength, bytes });
}

describe('quizFileKindAllowed', () => {
  it('takes text and markdown', () => {
    for (const name of ['notes.txt', 'Spec.MD', 'a.markdown', 'b.mdown', 'c.text']) {
      expect(quizFileKindAllowed(name)).toBe(true);
    }
  });

  it('refuses everything else, whatever the browser offered', () => {
    for (const name of ['brief.pdf', 'deck.pptx', 'photo.png', 'notes.md.zip', 'README']) {
      expect(quizFileKindAllowed(name)).toBe(false);
    }
  });
});

describe('readQuizFile', () => {
  it('reads a markdown file as text', () => {
    const result = read('notes.md', '# Rates\n\nA policy rate reaches prices slowly.\n');
    expect(result).toEqual({ ok: true, text: '# Rates\n\nA policy rate reaches prices slowly.' });
  });

  it('refuses a kind the answer did not allow', () => {
    expect(read('brief.pdf', 'anything')).toEqual({ ok: false, reason: 'kind' });
  });

  it('refuses a file over the byte cap without decoding it', () => {
    const result = readQuizFile({
      name: 'huge.md',
      size: MAX_QUIZ_FILE_BYTES + 1,
      bytes: new Uint8Array(),
    });
    expect(result).toEqual({ ok: false, reason: 'too-big' });
  });

  it('refuses one over the character cap rather than truncating it', () => {
    const result = read('long.md', 'x'.repeat(MAX_PASTE_CHARS + 1));
    expect(result).toEqual({ ok: false, reason: 'too-long' });
  });

  it('refuses something that is not text whatever it is called', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x41]);
    expect(readQuizFile({ name: 'fake.md', size: bytes.byteLength, bytes })).toEqual({
      ok: false,
      reason: 'not-text',
    });
  });

  it('refuses a binary that happens to decode, on its null bytes', () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x42]);
    expect(readQuizFile({ name: 'fake.md', size: bytes.byteLength, bytes })).toEqual({
      ok: false,
      reason: 'not-text',
    });
  });

  it('refuses an empty file', () => {
    expect(read('blank.txt', '   \n\n')).toEqual({ ok: false, reason: 'empty' });
  });
});
