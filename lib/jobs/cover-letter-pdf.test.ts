import { describe, expect, it } from 'vitest';
import { coverLetterPdf, letterBlocks, letterDate, letterFileName } from './cover-letter-pdf';

const text = (block: ReturnType<typeof letterBlocks>[number]) =>
  block.kind === 'para'
    ? block.lines.map((line) => line.map((run) => run.text).join('')).join('\n')
    : block.runs.map((run) => run.text).join('');

describe('letterBlocks', () => {
  it('drops a stored header up to the salutation', () => {
    const blocks = letterBlocks(
      'September 29, 2026\n\nNorthwind\nOperations Analyst\n\nDear Hiring Team:\n\nI am applying.\n\nSincerely,\n\nAlex Rivera\n',
    );
    expect(blocks.map(text)).toEqual([
      'Dear Hiring Team:',
      'I am applying.',
      'Sincerely,',
      'Alex Rivera',
    ]);
  });

  it('adds the salutation and sign-off a bare body lacks, signed with their name', () => {
    const blocks = letterBlocks('I am applying.\n\nThank you for your time.', 'Alex Rivera');
    expect(blocks.map(text)).toEqual([
      'Dear Hiring Team:',
      'I am applying.',
      'Thank you for your time.',
      'Sincerely,',
      'Alex Rivera',
    ]);
  });

  it('signs off without a name when they have given none', () => {
    expect(letterBlocks('I am applying.').map(text)).toEqual([
      'Dear Hiring Team:',
      'I am applying.',
      'Sincerely,',
    ]);
  });

  it('reads bullets, bolding a short lead before a colon', () => {
    const [, bullet, wrapped] = letterBlocks(
      'Dear team,\n\n- Own in ambiguity: At my last firm I led it.\n- **Apply AI**: models\nand more.\n\nBest,\nAlex Rivera',
    );
    expect(bullet).toEqual({
      kind: 'bullet',
      runs: [
        { text: 'Own in ambiguity:', bold: true },
        { text: ' At my last firm I led it.', bold: false },
      ],
    });
    expect(text(wrapped)).toBe('Apply AI: models and more.');
  });
});

describe('the download', () => {
  it('names the file and dates the letter as the Word letters did', () => {
    expect(letterFileName('Northwind / AI', 'Alex Rivera')).toBe(
      'Alex Rivera Cover Letter - Northwind AI.pdf',
    );
    expect(letterFileName('Northwind')).toBe('Cover Letter - Northwind.pdf');
    expect(letterDate(new Date('2026-10-03T15:00:00Z'), 'America/New_York')).toBe(
      'October 3, 2026',
    );
  });

  it('builds a PDF from text Times cannot all draw', async () => {
    const bytes = await coverLetterPdf({
      letter: 'Dear team,\n\nI → shipped it — fast ✓.',
      company: 'Northwind',
      timeZone: 'UTC',
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('draws a contact line of their own, whatever it holds', async () => {
    const bytes = await coverLetterPdf({
      letter: 'Dear team,\n\nI am applying.',
      company: 'Northwind',
      timeZone: 'UTC',
      letterhead: {
        signer: 'Alex Rivera',
        contact: '12 Rue Émile‑Zola, Lyon   +33 6 00 00 00 00   alex@example.com',
      },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});
