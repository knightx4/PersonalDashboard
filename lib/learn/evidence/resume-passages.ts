import { createHash } from 'node:crypto';

/**
 * Splitting a résumé into passages of a few sentences (plan #2006.5), so each
 * can be embedded and matched with the ideas it shows you used. Pure, so the
 * splitting can be tested without a database.
 *
 * A résumé arrives as text pulled out of a PDF: one line per printed line,
 * section names in capitals, bullets that wrap onto the next line, and the
 * employer, title, place and dates on lines of their own. A passage is one
 * bullet with its wrapped lines joined, prefixed with its section and the
 * lines naming the role it sits under, so "Built an automated revenue testing
 * system" is embedded as work at EY rather than on its own. Lines that are
 * never followed by a bullet (the name and contact details, a trailing date)
 * make no passage.
 */

export type ResumePassage = {
  position: number;
  /** What is embedded: the section, the role lines and the bullet. */
  body: string;
  /** The bullet's opening, quoted in the link's basis. */
  first_line: string;
  text_hash: string;
};

const BULLET = /^[•▪◦·*-]\s*/;
const INLINE_BULLET = /\s+[•▪◦]\s+/;
const YEARS = /\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current|now)\b/i;
const PLACE = /,\s*[A-Z]{2}$/;
/** An employer or school, opening with its name in capitals: "BAYLOR UNIVERSITY Waco, TX". */
const ORGANISATION = /^[A-Z&.]{2,}(?:\s+[A-Z&.]{2,})+\b/;
const FIRST_LINE_MAX = 120;

/** A section name: short and in capitals, such as "PROFESSIONAL EXPERIENCE". */
export function isSectionHeader(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && line.length <= 40 && letters === letters.toUpperCase();
}

/** A line naming a role, a place or its dates rather than continuing a bullet. */
export function isRoleLine(line: string): boolean {
  return (
    YEARS.test(line) || PLACE.test(line) || /^(?:19|20)\d{2}\b/.test(line) || ORGANISATION.test(line)
  );
}

export function firstLineOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…` : line;
}

export function passageHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}

type Item = { kind: 'header' | 'bullet' | 'line'; text: string };

function itemsOf(text: string): Item[] {
  const items: Item[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isBullet = BULLET.test(line);
    const parts = line.replace(BULLET, '').split(INLINE_BULLET);
    parts.forEach((part, index) => {
      const value = part.trim();
      if (!value) return;
      if (index > 0 || isBullet) items.push({ kind: 'bullet', text: value });
      else if (isSectionHeader(value)) items.push({ kind: 'header', text: value });
      else items.push({ kind: 'line', text: value });
    });
  }
  return items;
}

export function splitResume(text: string): ResumePassage[] {
  const passages: ResumePassage[] = [];
  let section = '';
  let context: string[] = [];
  let bullet: string | null = null;
  let lastWasBullet = false;

  const flush = () => {
    if (bullet === null) return;
    const body = [section, ...context, bullet].filter(Boolean).join('\n');
    const first = firstLineOf(bullet);
    if (first) {
      passages.push({ position: passages.length, body, first_line: first, text_hash: passageHash(body) });
    }
    bullet = null;
  };

  for (const item of itemsOf(text)) {
    if (item.kind === 'header') {
      flush();
      section = item.text;
      context = [];
      lastWasBullet = false;
    } else if (item.kind === 'bullet') {
      flush();
      bullet = item.text;
      lastWasBullet = true;
    } else if (bullet !== null && !isRoleLine(item.text)) {
      bullet = `${bullet} ${item.text}`;
    } else {
      flush();
      const startsEntry = lastWasBullet || ORGANISATION.test(item.text);
      context = startsEntry ? [item.text] : [...context, item.text];
      lastWasBullet = false;
    }
  }
  flush();
  return passages;
}
