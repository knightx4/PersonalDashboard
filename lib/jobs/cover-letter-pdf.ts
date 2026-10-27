/**
 * The cover letter as a one-page PDF, laid out like the Word letters it
 * replaces: US letter, a 1.5"
 * top margin and 1" elsewhere, Times 11pt single-spaced with a blank line
 * between paragraphs, and a rule with the contact line in 10pt pinned to the
 * foot of the first page.
 *
 * The letter opens with the date and the company. A stored letter that
 * already carries a header has it dropped up to its salutation, so the date
 * is always the day the PDF is made. One without a salutation or sign-off
 * gets the letter's usual ones.
 *
 * The name it is signed with and the contact line are the person's own, from
 * their Details tab (`letterheadFrom` in lib/you/details.ts). A letter whose
 * signer has given no name is signed off without one, and one with no contact
 * details has no rule or contact line at its foot.
 */
import { whenDate } from '@/lib/core/when';
import type { Letterhead } from '@/lib/you/details';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const PAGE = { width: 612, height: 792 };
const MARGIN = { top: 108, right: 72, bottom: 72, left: 72 };
const SIZE = 11;
// Word's single spacing for Times New Roman: 1.15 of the point size.
const LINE = SIZE * 1.15;
const ASCENT = 0.891;
const BULLET_X = MARGIN.left + 18;
const BULLET_TEXT_X = MARGIN.left + 36;
// From the docx's anchored shapes, in points from the top of the page.
const RULE_TOP = 750.75;
const CONTACT_TOP = 757.1;
const CONTACT_SIZE = 10;

export type Block = { kind: 'para'; lines: Run[][] } | { kind: 'bullet'; runs: Run[] };

export interface Run {
  text: string;
  bold: boolean;
}

const SALUTATION = /^(dear|to whom|hello|hi)\b/i;
const SIGN_OFF =
  /^(sincerely|best|regards|kind regards|best regards|thank you|warmly|respectfully)\b[^.]*,?\s*$/i;
const BULLET = /^\s*(?:[-*•▪◦]|\d+[.)])\s+/;

/** Splits **bold** markdown into runs; any other marker is left as text. */
export function parseRuns(text: string): Run[] {
  const runs: Run[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      runs.push({ text: part.slice(2, -2), bold: true });
    } else {
      runs.push({ text: part, bold: false });
    }
  }
  return runs;
}

/**
 * A bullet whose lead ends in a colon gets the lead in bold, as the Word
 * letter has it, when the lead is short and not already marked.
 */
function bulletRuns(text: string): Run[] {
  if (text.includes('**')) return parseRuns(text);
  const colon = text.indexOf(':');
  if (colon > 0 && colon <= 60 && text.slice(0, colon).split(/\s+/).length <= 6) {
    return [
      { text: text.slice(0, colon + 1), bold: true },
      { text: text.slice(colon + 1), bold: false },
    ];
  }
  return [{ text, bold: false }];
}

/** The letter's body, from the salutation to the signature, as blocks. */
export function letterBlocks(letter: string, signer: string | null = null): Block[] {
  let lines = letter.replace(/\r\n?/g, '\n').split('\n');
  const salutation = lines.findIndex((line) => SALUTATION.test(line.trim()));
  if (salutation >= 0) lines = lines.slice(salutation);

  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) paragraphs.push(current);
      current = [];
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) paragraphs.push(current);

  if (salutation < 0) paragraphs.unshift(['Dear Hiring Team:']);
  if (!paragraphs.some((para) => SIGN_OFF.test(para[0]))) {
    paragraphs.push(['Sincerely,'], ...(signer ? [[signer]] : []));
  }

  const blocks: Block[] = [];
  for (const para of paragraphs) {
    // A paragraph of bullets is a list; a paragraph with no bullet keeps its
    // line breaks, as a sign-off or an address does.
    let plain: string[] = [];
    const flush = () => {
      if (plain.length) blocks.push({ kind: 'para', lines: plain.map(parseRuns) });
      plain = [];
    };
    let bullet: Run[] | null = null;
    for (const line of para) {
      if (BULLET.test(line)) {
        flush();
        bullet = bulletRuns(line.replace(BULLET, ''));
        blocks.push({ kind: 'bullet', runs: bullet });
      } else if (bullet) {
        // A wrapped bullet line continues the bullet above it.
        bullet.push({ text: ` ${line}`, bold: false });
      } else {
        plain.push(line);
      }
    }
    flush();
  }
  return blocks;
}

/** The date as the letter writes it: October 3, 2026. */
export function letterDate(date: Date, timeZone: string): string {
  const [day, month, year] = whenDate(date, { timeZone, month: 'long' }).split(' ');
  return `${month} ${day}, ${year}`;
}

/** The name the download is saved under, as the Word letters were. */
export function letterFileName(company: string, signer: string | null = null): string {
  const safe = company
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const by = signer
    ?.replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${by ? `${by} ` : ''}Cover Letter - ${safe || 'Letter'}.pdf`;
}

// The standard fonts only encode WinAnsi; swap what Times cannot draw.
function encodable(text: string): string {
  return text
    .replace(/[‐‑‒–]/g, '–')
    .replace(/−/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[^\x20-\x7e -ÿ–—‘’‚“”„†‡•…‰‹›€™]/g, '');
}

interface Word {
  text: string;
  font: PDFFont;
  /** A space comes before this word on the line. */
  space: boolean;
}

function words(runs: Run[], regular: PDFFont, bold: PDFFont): Word[] {
  const out: Word[] = [];
  let pendingSpace = false;
  for (const run of runs) {
    const font = run.bold ? bold : regular;
    const pieces = encodable(run.text).split(/(\s+)/);
    for (const piece of pieces) {
      if (piece === '') continue;
      if (/^\s+$/.test(piece)) {
        pendingSpace = out.length > 0;
        continue;
      }
      // A run boundary inside a word ("**AI**:") glues without a space.
      out.push({ text: piece, font, space: pendingSpace });
      pendingSpace = false;
    }
  }
  return out;
}

function wrap(all: Word[], width: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let used = 0;
  for (const word of all) {
    const space = line.length && word.space ? word.font.widthOfTextAtSize(' ', SIZE) : 0;
    const w = word.font.widthOfTextAtSize(word.text, SIZE);
    if (line.length && used + space + w > width) {
      lines.push(line);
      line = [{ ...word, space: false }];
      used = w;
    } else {
      line.push(line.length ? word : { ...word, space: false });
      used += space + w;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawLine(page: PDFPage, line: Word[], x: number, y: number) {
  let at = x;
  for (const word of line) {
    if (word.space) at += word.font.widthOfTextAtSize(' ', SIZE);
    page.drawText(word.text, { x: at, y, size: SIZE, font: word.font, color: rgb(0, 0, 0) });
    at += word.font.widthOfTextAtSize(word.text, SIZE);
  }
}

/** Builds the letter's PDF bytes. */
export async function coverLetterPdf({
  letter,
  company,
  date = new Date(),
  timeZone,
  letterhead = { signer: null, contact: null },
}: {
  letter: string;
  company: string;
  /** Who signs it and the contact line at its foot, from their details. */
  letterhead?: Letterhead;
  date?: Date;
  /** The zone today is read in for the date line. */
  timeZone: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { signer, contact } = letterhead;
  doc.setTitle(`${signer ? `${signer} ` : ''}Cover Letter - ${company}`);
  if (signer) doc.setAuthor(signer);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const first = doc.addPage([PAGE.width, PAGE.height]);
  let page = first;
  // Baseline of the next line, from the bottom of the page.
  let y = PAGE.height - MARGIN.top - SIZE * ASCENT;
  const bodyWidth = PAGE.width - MARGIN.left - MARGIN.right;
  // The first page stops above the contact line; later pages at the margin.
  const floor = () => (page === first && contact ? PAGE.height - RULE_TOP + 6 : MARGIN.bottom);

  const advance = () => {
    y -= LINE;
    if (y < floor()) {
      page = doc.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - 72 - SIZE * ASCENT;
    }
  };
  const blank = () => advance();

  const header: Block[] = [
    { kind: 'para', lines: [[{ text: letterDate(date, timeZone), bold: false }]] },
    ...(company.trim()
      ? [{ kind: 'para' as const, lines: [[{ text: company.trim(), bold: false }]] }]
      : []),
  ];
  const blocks = [...header, ...letterBlocks(letter, signer)];

  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    if (block.kind === 'para') {
      for (const source of block.lines) {
        for (const line of wrap(words(source, regular, bold), bodyWidth)) {
          drawLine(page, line, MARGIN.left, y);
          advance();
        }
      }
    } else {
      const lines = wrap(
        words(block.runs, regular, bold),
        PAGE.width - MARGIN.right - BULLET_TEXT_X,
      );
      lines.forEach((line, i) => {
        if (i === 0) page.drawText('•', { x: BULLET_X, y, size: SIZE, font: regular });
        drawLine(page, line, BULLET_TEXT_X, y);
        advance();
      });
    }
    // Bullets in a list sit together; every other block has a blank line after it.
    if (next && !(block.kind === 'bullet' && next.kind === 'bullet')) blank();
  });

  if (!contact) return doc.save();
  const ruleY = PAGE.height - RULE_TOP;
  first.drawLine({
    start: { x: MARGIN.left - 2.7, y: ruleY },
    end: { x: MARGIN.left - 2.7 + 468.55, y: ruleY },
    thickness: 0.75,
    color: rgb(0, 0, 0),
  });
  first.drawText(encodable(contact), {
    x: MARGIN.left,
    y: PAGE.height - CONTACT_TOP - CONTACT_SIZE * ASCENT,
    size: CONTACT_SIZE,
    font: regular,
    color: rgb(0, 0, 0),
  });

  return doc.save();
}
