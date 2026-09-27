/**
 * Render a cover letter from a plain-text source into the two files the
 * person keeps: an HTML page, which is uploaded to Drive and converts there
 * into an editable Google Doc (and from it a .docx, via File > Download), and
 * a .pdf.
 *
 *   npx tsx scripts/cover-letter.ts <letter.txt> [out-dir]
 *
 * The source is a header, a line of three dashes, then the body:
 *
 *   name: Selvey Knight
 *   contact: 350 W 50th, New York, NY 10019 | 210 882-7770 | a@b.com
 *   date: September 27, 2026
 *   company: Hebbia
 *   salutation: Dear Hiring Team:
 *   ---
 *   First paragraph.
 *
 *   - **Lead phrase.** Rest of the bulleted paragraph.
 *
 *   Closing paragraph.
 *
 * Paragraphs are separated by a blank line. A paragraph starting with "- " is
 * a bullet, and **text** is bold. The layout follows the person's own letters:
 * Times New Roman at 11pt, one-inch margins, bold lead phrases on the bullets.
 *
 * The .pdf comes from the Chromium Playwright installs, printed headless. The
 * container's LibreOffice has no Writer, so it cannot do this. The script
 * prints the page count, because a letter that runs to a second page needs
 * cutting before it goes anywhere.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

type Letter = {
  name: string;
  contact: string;
  date: string;
  company: string;
  salutation: string;
  paragraphs: string[];
};

function parse(source: string): Letter {
  const [head, ...rest] = source.split(/^---\s*$/m);
  if (rest.length === 0) throw new Error('No "---" line between the header and the body.');

  const fields = new Map<string, string>();
  for (const line of head.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) fields.set(match[1], match[2].trim());
  }
  const need = (key: string) => {
    const value = fields.get(key);
    if (!value) throw new Error(`The header has no "${key}:" line.`);
    return value;
  };

  const paragraphs = rest
    .join('---')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

  return {
    name: need('name'),
    contact: need('contact'),
    date: need('date'),
    company: need('company'),
    salutation: need('salutation'),
    paragraphs,
  };
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text: string): string {
  return escape(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// The container links its Playwright Chromium here; elsewhere, set CHROME_PATH.
const CHROME =
  process.env.CHROME_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);

const P = 'margin:0 0 11pt 0;';

function render(letter: Letter): string {
  const body: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    body.push(`<ul style="margin:0 0 11pt 0;">${bullets.join('')}</ul>`);
    bullets = [];
  };

  for (const paragraph of letter.paragraphs) {
    if (paragraph.startsWith('- ')) {
      bullets.push(`<li style="${P}">${inline(paragraph.slice(2))}</li>`);
    } else {
      flush();
      body.push(`<p style="${P}">${inline(paragraph)}</p>`);
    }
  }
  flush();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escape(letter.name)} Cover Letter - ${escape(letter.company)}</title>
<style>
  @page { size: 8.5in 11in; margin: 1in; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.15; }
</style>
</head>
<body style="font-family:'Times New Roman',Times,serif;font-size:11pt;">
<p style="${P}">${escape(letter.date)}</p>
<p style="${P}">${escape(letter.company)}</p>
<p style="${P}">${escape(letter.salutation)}</p>
${body.join('\n')}
<p style="${P}">Sincerely,</p>
<p style="margin:0;">${escape(letter.name)}</p>
<p style="margin:4pt 0 0 0;padding-top:4pt;border-top:1px solid #000;font-size:10pt;">${escape(letter.contact)}</p>
</body>
</html>
`;
}

function pageCount(pdf: string): number {
  const bytes = readFileSync(pdf, 'latin1');
  return (bytes.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

function main() {
  const [input, outArg] = process.argv.slice(2);
  if (!input) {
    console.error('usage: npx tsx scripts/cover-letter.ts <letter.txt> [out-dir]');
    process.exit(1);
  }

  const letter = parse(readFileSync(input, 'utf8'));
  const outDir = resolve(outArg ?? '.');
  mkdirSync(outDir, { recursive: true });

  const stem = `${letter.name} Cover Letter - ${letter.company}`;
  const html = join(outDir, `${stem}.html`);
  writeFileSync(html, render(letter));

  if (!CHROME) throw new Error('No Chromium found. Set CHROME_PATH to a chrome binary.');
  const pdf = join(outDir, `${stem}.pdf`);
  execFileSync(
    CHROME,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdf}`,
      `file://${html}`,
    ],
    { stdio: 'ignore' },
  );

  const pages = pageCount(pdf);
  const words = letter.paragraphs.join(' ').split(/\s+/).length;
  console.log(`${basename(html)} and .pdf written to ${outDir}`);
  console.log(`${words} words in the body, ${pages} page${pages === 1 ? '' : 's'}`);
  if (pages > 1) console.log('Over one page: cut it before sending.');
}

main();
