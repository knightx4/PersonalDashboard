import { describe, expect, it } from 'vitest';
import { coverLetterPdf, letterBlocks, letterDate, letterFileName } from './cover-letter-pdf';

const text = (block: ReturnType<typeof letterBlocks>[number]) =>
  block.kind === 'para'
    ? block.lines.map((line) => line.map((run) => run.text).join('')).join('\n')
    : block.runs.map((run) => run.text).join('');

describe('letterBlocks', () => {
  it('drops a stored header up to the salutation', () => {
    const blocks = letterBlocks(
      'September 29, 2026\n\nHebbia\nForward Deployed Banker\n\nDear Hiring Team:\n\nI am applying.\n\nSincerely,\n\nSelvey Knight\n',
    );
    expect(blocks.map(text)).toEqual([
      'Dear Hiring Team:',
      'I am applying.',
      'Sincerely,',
      'Selvey Knight',
    ]);
  });

  it('adds the salutation and sign-off a bare body lacks', () => {
    const blocks = letterBlocks('I am applying.\n\nThank you for your time.');
    expect(blocks.map(text)).toEqual([
      'Dear Hiring Team:',
      'I am applying.',
      'Thank you for your time.',
      'Sincerely,',
      'Selvey Knight',
    ]);
  });

  it('reads bullets, bolding a short lead before a colon', () => {
    const [, bullet, wrapped] = letterBlocks(
      'Dear team,\n\n- Own in ambiguity: At EY I led it.\n- **Apply AI**: models\nand more.\n\nBest,\nSelvey Knight',
    );
    expect(bullet).toEqual({
      kind: 'bullet',
      runs: [
        { text: 'Own in ambiguity:', bold: true },
        { text: ' At EY I led it.', bold: false },
      ],
    });
    expect(text(wrapped)).toBe('Apply AI: models and more.');
  });
});

describe('the download', () => {
  it('names the file and dates the letter as the Word letters did', () => {
    expect(letterFileName('Hebbia / AI')).toBe('Selvey Knight Cover Letter - Hebbia AI.pdf');
    expect(letterDate(new Date(2026, 9, 3))).toBe('October 3, 2026');
  });

  it('builds a PDF from text Times cannot all draw', async () => {
    const bytes = await coverLetterPdf({
      letter: 'Dear team,\n\nI → shipped it — fast ✓.',
      company: 'Hebbia',
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
