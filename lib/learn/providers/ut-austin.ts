import 'server-only';

import type { StructureDocumentInput, StructureReading, StructureUnit } from '@/lib/learn/catalogue/structure';
import { fetchDocument } from './fetch';
import { extractPdfPages } from './pdf-text';

/**
 * UT Austin's public syllabi, searched by department and term (plan #2247.4).
 *
 * The University of Texas at Austin publishes the syllabus of most taught
 * sections at utdirect.utexas.edu/apps/student/coursedocs/nlogon/, a plain GET
 * form with no login. The form needs a year, a semester (2 spring, 6 summer,
 * 9 fall) and a department code from its own select; without a department it
 * echoes the form back with no results. `course_title` is a partial match on
 * the section title. The results are one HTML table, a row per section: the
 * term, the course code, the unique number, the title, the instructors, a CV
 * link per instructor and then the syllabus link. The syllabus is a PDF under
 * /apps/student/coursedocs/courses/nlogon/download/<id>/, or, for a minority
 * of sections, a page on utexas.simplesyllabus.com that needs JavaScript to
 * show anything; those are recorded as not fetchable and never fetched.
 *
 * Licence mode is `structure_only` for every document. A syllabus is its
 * instructor's copyright, and the fixtures say so in as many words ("The
 * content of this course is my intellectual property", "Sharing of Course
 * Materials is Prohibited"). The store keeps the extracted text as the record
 * of what was read, and the order, headings, topics, readings and textbook
 * names as the structure; no sentence of the syllabus is shown or given to a
 * model as material.
 *
 * The parsers are pure functions of the page or of the text a PDF yields,
 * tested against fixtures saved from live fetches on 2026-10-16
 * (fixtures/structure/ut-austin/). The fetch path is ./fetch. Nothing here
 * writes; lib/learn/catalogue/ut-austin-pull.ts proposes, screens and stores.
 */

export const UT_PROVIDER_SLUG = 'ut-austin';
export const UT_LICENCE_MODE = 'structure_only' as const;
export const UT_HOST = 'utdirect.utexas.edu';
export const UT_FORM_URL = `https://${UT_HOST}/apps/student/coursedocs/nlogon/`;
const DOWNLOAD_PATH = /^\/apps\/student\/coursedocs\/courses\/nlogon\/download\/(\d+)\/?$/;
const SIMPLE_SYLLABUS_HOST = 'utexas.simplesyllabus.com';

// ---------------------------------------------------------------------------
// Terms

export const UT_SEMESTERS = { 2: 'Spring', 6: 'Summer', 9: 'Fall' } as const;
export type UtSemester = keyof typeof UT_SEMESTERS;
export type UtTerm = { year: number; semester: UtSemester; label: string };

function term(year: number, semester: UtSemester): UtTerm {
  return { year, semester, label: `${year} ${UT_SEMESTERS[semester]}` };
}

/**
 * The current term and the ones before it, newest first. A term is current
 * from its first month: spring from January, summer from June, fall from
 * August, which is when each one's syllabi start to appear.
 */
export function recentTerms(now: Date, count = 8): UtTerm[] {
  const month = now.getUTCMonth() + 1;
  let year = now.getUTCFullYear();
  let semester: UtSemester = month >= 8 ? 9 : month >= 6 ? 6 : 2;
  const out: UtTerm[] = [];
  while (out.length < count) {
    out.push(term(year, semester));
    if (semester === 9) semester = 6;
    else if (semester === 6) semester = 2;
    else {
      semester = 9;
      year -= 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The form and its results

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function plain(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export type UtDepartment = { code: string; name: string };

/** The department codes the form offers, as its select lists them ("HIS", "B A"). */
export function parseDepartments(formHtml: string): UtDepartment[] {
  const select = /<select\b[^>]*name="department"[^>]*>([\s\S]*?)<\/select>/i.exec(formHtml)?.[1] ?? '';
  const out: UtDepartment[] = [];
  for (const match of select.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)) {
    const code = decodeEntities(match[1]).trim();
    if (!code) continue;
    const label = plain(match[2]);
    const name = label.startsWith(`${code}-`) ? label.slice(code.length + 1).trim() : label;
    out.push({ code, name });
  }
  return out;
}

export type UtSearch = { year: number; semester: UtSemester; department: string; courseTitle: string };

/** The results address for one search, every field the form sends, in its order. */
export function utSearchUrl(search: UtSearch): string {
  const params = new URLSearchParams([
    ['year', String(search.year)],
    ['semester', String(search.semester)],
    ['department', search.department],
    ['course_number', ''],
    ['course_title', search.courseTitle.trim()],
    ['unique', ''],
    ['csn', ''],
    ['instructor_first', ''],
    ['instructor_last', ''],
    ['course_type', 'In Residence'],
  ]);
  return `${UT_FORM_URL}?${params.toString()}`;
}

export function utDownloadUrl(id: string): string {
  return `https://${UT_HOST}/apps/student/coursedocs/courses/nlogon/download/${id}/`;
}

export type UtSyllabusLink = { kind: 'download'; id: string; url: string } | { kind: 'simple-syllabus'; url: string };

export type UtResultRow = {
  /** "2026 Fall", as the table gives it. */
  term: string;
  /** "HIS 317L". */
  courseCode: string;
  unique: string;
  /** The section title without the table's closing full stop. */
  title: string;
  instructors: string[];
  /** Null when the section has no syllabus posted. */
  syllabus: UtSyllabusLink | null;
};

export type UtResults = {
  /** False when the page has no results table: the form was echoed back. */
  searched: boolean;
  rows: UtResultRow[];
};

function syllabusLink(cell: string): UtSyllabusLink | null {
  for (const match of cell.matchAll(/<a\b[^>]*href="([^"]+)"/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), UT_FORM_URL);
    } catch {
      continue;
    }
    const id = url.hostname === UT_HOST ? DOWNLOAD_PATH.exec(url.pathname)?.[1] : undefined;
    if (id) return { kind: 'download', id, url: utDownloadUrl(id) };
    if (url.hostname === SIMPLE_SYLLABUS_HOST) return { kind: 'simple-syllabus', url: url.href };
  }
  return null;
}

/**
 * The rows of a results page. The syllabus is the seventh cell; the sixth
 * holds one CV link per instructor and is never read as a syllabus, though
 * its links are under the same download path.
 */
export function parseUtResults(html: string): UtResults {
  const table = /<table\b[^>]*id="results_table"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) return { searched: false, rows: [] };
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1] ?? '';
  const rows: UtResultRow[] = [];
  for (const chunk of body.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = [...chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 7) continue;
    const courseCode = plain(cells[1]);
    const title = plain(cells[3]).replace(/\.$/, '');
    if (!courseCode || !title) continue;
    rows.push({
      term: plain(cells[0]),
      courseCode,
      unique: plain(cells[2]),
      title,
      instructors: cells[4]
        .split(/<br\s*\/?>/i)
        .map(plain)
        .filter((name) => name !== ''),
      syllabus: syllabusLink(cells[6]),
    });
  }
  return { searched: true, rows };
}

// ---------------------------------------------------------------------------
// A syllabus's text

export type ParsedSyllabus = {
  units: StructureUnit[];
  textbooks: string[];
  outcomes: string[];
  prerequisites: string[];
};

/** Fewer units than this and the document has no schedule worth keeping. */
export const MIN_UNITS = 3;
const MAX_TOPICS = 12;
const MAX_READINGS = 12;
const MAX_TEXTBOOKS = 8;
const MAX_OUTCOMES = 12;

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A unit's own heading: Week, then Unit or Module, then Session, Class or Lecture, coarsest first. */
const UNIT_HEAD = new RegExp(
  `^(week|unit|module|session|class|lecture)\\s+(\\d{1,2}|${NUMBER_WORDS.join('|')})(?![\\w/])\\s*[:.)\\-–—]*\\s*(.*)$`,
  'i',
);
const UNIT_RANK: Record<string, number> = { week: 0, unit: 1, module: 1, session: 2, class: 2, lecture: 2 };
const DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?';
const DATE_WORD = new RegExp(
  `^(?:${DAY}\\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)[,:.]?\\s*(.*)$`,
  'i',
);
const DATE_NUM = new RegExp(`^(?:${DAY}\\s+)?(\\d{1,2})\\/(\\d{1,2})(?:\\/\\d{2,4})?(?![\\d/])[,:.]?\\s*(.*)$`, 'i');
const READINGS_HEAD = /^(?:required\s+)?readings?\s*:\s*(.*)$/i;
const BULLET = /^(?:[•◦▪●*·-]|\d{1,2}[.)]|[a-z][.)]|[ivx]+[.)])\s*/i;
const CONNECTOR = /\b(?:of|the|and|for|in|on|to|a|an|with|from|at|by|or|&)$/i;
const SEPARATORS = /^[\s:.,;–—-]+/;

type Line =
  | { kind: 'unit'; rank: number; n: number; rest: string }
  | { kind: 'date'; month: number; day: number; rest: string }
  | { kind: 'readings'; rest: string }
  | { kind: 'text' };

function unitNumber(token: string): number {
  const word = NUMBER_WORDS.indexOf(token.toLowerCase());
  return word >= 0 ? word : Number(token);
}

function classify(line: string): Line {
  const unit = UNIT_HEAD.exec(line);
  if (unit) {
    return { kind: 'unit', rank: UNIT_RANK[unit[1].toLowerCase()], n: unitNumber(unit[2]), rest: unit[3] };
  }
  const word = DATE_WORD.exec(line);
  if (word) {
    const day = Number(word[2]);
    if (day >= 1 && day <= 31) {
      return { kind: 'date', month: MONTHS.indexOf(word[1].toLowerCase()) + 1, day, rest: word[3] };
    }
  }
  const num = DATE_NUM.exec(line);
  if (num) {
    const month = Number(num[1]);
    const day = Number(num[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { kind: 'date', month, day, rest: num[3] };
  }
  const readings = READINGS_HEAD.exec(line);
  if (readings) return { kind: 'readings', rest: readings[1] };
  return { kind: 'text' };
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** A short heading-like line that ends a block: "Resources & Policies", "***Paper due***". */
function isBlockEnd(line: string): boolean {
  if (/^\*{2,}/.test(line)) return true;
  if (BULLET.test(line)) return false;
  return words(line) <= 5 && /^[A-Z]/.test(line) && !/[.,;:)”"’]$/.test(line);
}

function parenDepth(text: string): number {
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
  }
  return depth;
}

function joinLine(before: string, next: string): string {
  return /[a-z]-$/.test(before) ? `${before.slice(0, -1)}${next}` : `${before} ${next}`;
}

/** Whether a reference in brackets names readings: "(Katz)", "(Womack, pp. 331-387)", "(source doc, Reed)". */
function looksLikeReadings(inner: string): boolean {
  if (/https?:/i.test(inner)) return false;
  if (/[,;]/.test(inner) || /\b(?:chs?|pp?)\.\s*\d/i.test(inner) || /source docs?/i.test(inner)) return true;
  return /^[A-Z][\p{L}’'-]+$/u.test(inner.trim());
}

type Entry = { topic: string; readings: StructureReading[] };

/** Split on a separator that is not inside brackets. */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Replace each outermost bracketed group, nested brackets and all, with what `replace` returns for its inside. */
function replaceOuterParens(text: string, replace: (inner: string, whole: string) => string): string {
  let out = '';
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === ')' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        out = out.replace(/\s+$/, '') + replace(text.slice(start + 1, i), text.slice(start, i + 1));
        start = -1;
      }
      continue;
    }
    if (depth === 0) out += char;
  }
  return depth > 0 ? out + text.slice(start) : out;
}

/** A dated line of a schedule as a topic and the readings it names in brackets. */
function readEntry(text: string): Entry | null {
  // A range ("Mon. Nov. 24-Fri. Nov. 28, No classes") keeps what follows its end.
  let topic = text.replace(new RegExp(`^[-–]\\s*(?:${DAY}\\s+)?[a-z]+\\.?\\s+\\d{1,2},?\\s*`, 'i'), '');
  topic = topic.replace(SEPARATORS, '');
  const readings: StructureReading[] = [];
  topic = replaceOuterParens(topic, (inner, whole) => {
    if (/https?:/i.test(inner)) return '';
    if (!looksLikeReadings(inner)) return ` ${whole}`;
    for (const part of splitOutside(inner, ';')) {
      const title = part.trim();
      if (title) readings.push({ title });
    }
    return '';
  });
  topic = topic.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim();
  return topic ? { topic, readings } : null;
}

const NOT_A_READING =
  /^(?:this|these|the (?:text|excerpts?|primary|readings?|pownall)|please|be sure|be prepared|you (?:can|should|will|may)|each of|all of|both of|no (?:additional|primary|readings?)|i have|here is|find an|due to|how does|pat yourself|come to class|there are no|instead|students should|it is|reprinted)\b/i;
/** A publisher and year on their own: "Yale University Press, 2013". */
const PUBLISHER_ONLY = /^[\p{L} .&]+(?:press|books|publishing),?\s*\d{4}$/iu;

/** The readings a block of lines under "Readings:" lists, one per sentence that names a work. */
function readingsFrom(lines: string[]): StructureReading[] {
  if (lines.length === 0) return [];
  const text = lines.reduce((joined, line) => (joined ? joinLine(joined, line) : line), '');
  const out: StructureReading[] = [];
  for (const raw of text.split(/(?<=[a-z0-9)”"][.])\s+(?=[A-Z“"‘])|(?<=\))\s+(?=[A-Z“"‘])/)) {
    const sentence = raw.trim();
    if (words(sentence) < 3 || /https?:/i.test(sentence) || NOT_A_READING.test(sentence)) continue;
    if (/^none\.?$/i.test(sentence)) continue;
    const pages = /,?\s*(?:pages?|pp\.)\s*(\d+\s*[-–]\s*\d+)/i.exec(sentence);
    let title = sentence.replace(/\s*\((?:from|beginning|read|all)\b[^)]*\)?/gi, '');
    if (pages) title = title.replace(pages[0], '');
    title = title.replace(/,”/g, '”').replace(/[\s.,;:]+$/, '').trim().slice(0, 240);
    title = title.replace(/\s*,?\s*which (?:is|are) (?:posted|available)\b.*$/i, '').replace(/\s*\(posted on canvas[^)]*\)/i, '');
    if (words(title) < 2 || PUBLISHER_ONLY.test(title)) continue;
    out.push(pages ? { title, detail: `pp. ${pages[1].replace(/\s+/g, '')}` } : { title });
  }
  return out;
}

function pushUnique<T>(list: T[], value: T, key: (value: T) => string, cap: number) {
  if (list.length >= cap) return;
  if (!list.some((existing) => key(existing) === key(value))) list.push(value);
}

/** The index of each accepted unit head: one rank, numbers rising. Empty when there are fewer than MIN_UNITS. */
function unitHeads(classified: Line[]): number[] {
  for (const rank of [0, 1, 2]) {
    const accepted: number[] = [];
    let last = 0;
    classified.forEach((line, index) => {
      if (line.kind === 'unit' && line.rank === rank && line.n > last) {
        accepted.push(index);
        last = line.n;
      }
    });
    if (accepted.length >= MIN_UNITS) return accepted;
  }
  return [];
}

/** The days since 1970 of a month and day in a year, and the Monday-based week they fall in. */
function weekOf(year: number, month: number, day: number): number {
  const days = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return Math.floor((days + 3) / 7);
}

/**
 * The schedule of a syllabus, from the text its PDF yields.
 *
 * Three shapes are read, tried in this order. Where the document has unit
 * heads (lines starting Week, Unit or Module, Session, Class or Lecture with
 * a number, rising), each head is a unit and the dated lines under it are its
 * topics, with the readings each one names in brackets or in a "Readings:"
 * block. Where it has only dated lines ("8/24 Intro", "Mon. Sep. 8:
 * Porfirian Mexico"), the dates are grouped into the weeks they fall in,
 * numbered from the first. Where it has neither, a run of at least eight
 * classes numbered from 1 is read as one unit each. A document with fewer
 * than three units has no schedule and yields none.
 *
 * `year` places dates in a week; it is the term's year.
 */
export function parseSyllabusSchedule(text: string, year: number, textbook?: string): StructureUnit[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && !/^\d{1,2}$/.test(line));
  const classified = lines.map(classify);
  const heads = unitHeads(classified);
  if (heads.length > 0) return weekUnits(lines, classified, heads);
  const dated = datedUnits(classified, year, textbook);
  return dated.length > 0 ? dated : numberedUnits(lines);
}

/** A numbered schedule needs this many classes in a row before it is read as one. */
const MIN_NUMBERED = 8;
const NUMBERED_LINE = /^(\d{1,2})\.\s+(\S.*)$/;

/**
 * The last shape: classes numbered 1, 2, 3 and on with no dates, as HIS 353
 * lays out its fourteen meetings under three parts. Only a run from 1 rising
 * by one, at least eight long, with short lines, is read, so a numbered list
 * of books or policies is not mistaken for a schedule. The longest such run
 * wins.
 */
function numberedUnits(lines: string[]): StructureUnit[] {
  let best: StructureUnit[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    const first = NUMBERED_LINE.exec(lines[start]);
    if (!first || first[1] !== '1' || words(first[2]) > 14) continue;
    const run: StructureUnit[] = [];
    let expected = 1;
    let gap = 0;
    for (let i = start; i < lines.length && gap <= 4; i += 1) {
      const match = NUMBERED_LINE.exec(lines[i]);
      if (match && Number(match[1]) === expected && words(match[2]) <= 14) {
        const heading = match[2].replace(/^\(/, '').replace(/[\s.]+$/, '').trim();
        run.push({ label: String(expected), heading, topics: [], readings: [] });
        expected += 1;
        gap = 0;
      } else {
        gap += 1;
      }
    }
    if (run.length > best.length) best = run;
  }
  return best.length >= MIN_NUMBERED ? best : [];
}

function weekUnits(lines: string[], classified: Line[], heads: number[]): StructureUnit[] {
  const headSet = new Set(heads);
  const units: StructureUnit[] = [];
  let unit: (StructureUnit & { pending: string[] }) | null = null;
  let entry: string | null = null;
  let state: 'title' | 'readings' | 'idle' = 'idle';
  let readingLines: string[] = [];

  const flushReadings = () => {
    if (unit && readingLines.length > 0) {
      for (const reading of readingsFrom(readingLines)) {
        pushUnique(unit.readings, reading, (r) => r.title, MAX_READINGS);
      }
    }
    readingLines = [];
  };
  const flushEntry = () => {
    if (unit && entry !== null) {
      const read = readEntry(entry);
      if (read) {
        pushUnique(unit.topics, read.topic, (t) => t, MAX_TOPICS);
        for (const reading of read.readings) pushUnique(unit.readings, reading, (r) => r.title, MAX_READINGS);
      }
    }
    entry = null;
  };
  const closeUnit = () => {
    flushEntry();
    flushReadings();
    if (!unit) return;
    const heading = unit.heading || unit.topics[0] || unit.pending[0] || unit.label || '';
    if (heading) {
      units.push({ label: unit.label, heading, topics: unit.topics, readings: unit.readings });
    }
    unit = null;
  };

  // The schedule ends at the first block-ending heading after the last unit's dated lines.
  const lastHead = heads[heads.length - 1];
  let end = lines.length;
  for (let i = lastHead + 1; i < lines.length; i += 1) {
    if (classified[i].kind === 'date' || classified[i].kind === 'readings') continue;
    if (isBlockEnd(lines[i]) && !classified.slice(i + 1, i + 4).some((line) => line.kind === 'date')) {
      end = i;
      break;
    }
  }

  for (let i = heads[0]; i < end; i += 1) {
    const line = lines[i];
    const kind = classified[i];
    if (headSet.has(i) && kind.kind === 'unit') {
      closeUnit();
      const word = /^(\w+)/.exec(line)![1];
      const label = `${word[0].toUpperCase()}${word.slice(1).toLowerCase()} ${kind.n}`;
      const heading = kind.rest.replace(SEPARATORS, '').replace(/[\s:]+$/, '').trim();
      unit = { label, heading, topics: [], readings: [], pending: [] };
      state = 'idle';
      continue;
    }
    if (!unit) continue;
    if (kind.kind === 'date') {
      flushEntry();
      flushReadings();
      entry = kind.rest;
      state = 'title';
      continue;
    }
    if (kind.kind === 'readings') {
      flushEntry();
      flushReadings();
      state = 'readings';
      if (kind.rest && !/^none\.?$/i.test(kind.rest)) readingLines.push(kind.rest);
      continue;
    }
    if (state === 'title' && entry !== null) {
      const next = classified[i + 1];
      const nextIsHead = !next || next.kind !== 'text';
      if (
        parenDepth(entry) > 0 ||
        (/^[a-z]/.test(line) && !/^https?:/.test(line)) ||
        CONNECTOR.test(entry) ||
        /[,:–—-]$/.test(entry) ||
        (words(line) <= 4 && !/[.!?]$/.test(entry) && nextIsHead)
      ) {
        entry = joinLine(entry, line);
        continue;
      }
      flushEntry();
      state = 'idle';
    }
    if (state === 'readings') {
      if (isBlockEnd(line) || /^deadline\b/i.test(line)) {
        flushReadings();
        state = 'idle';
      } else {
        readingLines.push(line);
      }
      continue;
    }
    // A line under a head with nothing dated yet names the week: "Thanksgiving Break."
    if (!unit.heading && unit.topics.length === 0 && entry === null && !/^deadline\b/i.test(line)) {
      unit.pending.push(line.replace(/[\s.]+$/, ''));
    }
  }
  closeUnit();
  return units;
}

function datedUnits(classified: Line[], year: number, textbook?: string): StructureUnit[] {
  const units: StructureUnit[] = [];
  let firstWeek: number | null = null;
  let lastDay = -Infinity;
  let current: { week: number; unit: StructureUnit } | null = null;
  classified.forEach((line) => {
    if (line.kind !== 'date') return;
    const day = Date.UTC(year, line.month - 1, line.day);
    if (day < lastDay) return;
    lastDay = day;
    // "Homework Chap 2 due" is a deadline, not something taught.
    if (/\bdue\b/i.test(line.rest)) return;
    let rest = line.rest;
    // "Supply and Demand Chap Two": the trailing chapter is the textbook reading.
    const chapter = /\s+(chaps?\.?\s+[\w ,–-]+)$/i.exec(rest);
    if (chapter) rest = rest.slice(0, chapter.index);
    if (!rest.trim()) return;
    const read = readEntry(rest);
    if (!read) return;
    const week = weekOf(year, line.month, line.day);
    firstWeek ??= week;
    if (!current || current.week !== week) {
      current = {
        week,
        unit: { label: `Week ${week - firstWeek + 1}`, heading: read.topic, topics: [], readings: [] },
      };
      units.push(current.unit);
    }
    pushUnique(current.unit.topics, read.topic, (t) => t, MAX_TOPICS);
    for (const reading of read.readings) pushUnique(current.unit.readings, reading, (r) => r.title, MAX_READINGS);
    if (chapter) {
      pushUnique(
        current.unit.readings,
        { title: textbook ?? 'Textbook', detail: chapter[1].trim() },
        (r) => `${r.title} ${r.detail ?? ''}`,
        MAX_READINGS,
      );
    }
  });
  return units.length >= MIN_UNITS ? units : [];
}

const TEXTBOOK_HEAD =
  /^(?:\d+\.\s*)?(?:required\s+(?:books?|texts?|textbooks?|readings?)|textbooks?|books|course texts?|set texts)\s*:?$/i;
const TEXTBOOK_STOP = /^(?:you may|all other|the coop|optional|more required|note|almost all|these|i strongly)\b/i;
const OUTCOMES_HEAD =
  /^(?:course goals and )?(?:student )?(?:learning (?:outcomes|objectives)|course (?:objectives|goals|outcomes))\b/i;
const PREREQ_HEAD = /^prerequisites?(?:\s+requirements?)?\s*:\s*(.*)$/i;

function stripBullet(line: string): string {
  return line.replace(BULLET, '').trim();
}

/** The textbooks under the first heading that names them: "Required Books", "Textbook:", "1. Books". */
export function parseTextbooks(lines: string[]): string[] {
  const start = lines.findIndex((line) => TEXTBOOK_HEAD.test(line));
  if (start < 0) return [];
  const items: string[] = [];
  let open: string | null = null;
  const close = () => {
    if (open !== null) {
      const item = open.replace(/\s*\*$/, '').replace(/\.\s+This is\b.*$/, '').replace(/\.$/, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (words(item) >= 3 && /,|\bby\b/i.test(item)) items.push(item);
    }
    open = null;
  };
  for (const line of lines.slice(start + 1, start + 25)) {
    if (TEXTBOOK_STOP.test(line)) break;
    if (BULLET.test(line) && !/^\d{4}/.test(line)) {
      // "2. Shorter readings, by order of appearance:" is the next list, not a book.
      if (/:$/.test(line)) break;
      close();
      open = stripBullet(line);
      continue;
    }
    if (open === null && (/:$/.test(line) || isBlockEnd(line))) break;
    open = open === null ? line : joinLine(open, line);
    if (/[).]\s*\*?$/.test(line)) close();
    if (items.length >= MAX_TEXTBOOKS) break;
  }
  close();
  return items.slice(0, MAX_TEXTBOOKS);
}

/** The bulleted list under a "Learning Outcomes" style heading. */
export function parseOutcomes(lines: string[]): string[] {
  const start = lines.findIndex((line) => OUTCOMES_HEAD.test(line));
  if (start < 0) return [];
  const items: string[] = [];
  let intro = 0;
  for (const line of lines.slice(start + 1, start + 40)) {
    if (BULLET.test(line)) {
      items.push(stripBullet(line).replace(/^à\s*/, ''));
      if (items.length >= MAX_OUTCOMES) break;
      continue;
    }
    if (items.length === 0) {
      if ((intro += 1) > 2) break;
      continue;
    }
    if (/^[a-z]/.test(line)) items[items.length - 1] = joinLine(items[items.length - 1], line);
    else break;
  }
  return items.map((item) => item.replace(/[\s;]+$/, '')).filter((item) => words(item) >= 2);
}

/** The course's stated prerequisites, as one entry, when a line opens with "Prerequisite:". */
export function parsePrerequisites(lines: string[]): string[] {
  const start = lines.findIndex((line) => PREREQ_HEAD.test(line));
  if (start < 0) return [];
  let text = PREREQ_HEAD.exec(lines[start])![1];
  for (const line of lines.slice(start + 1, start + 12)) {
    if (/:$/.test(line) || /^[A-Z][\w ]{0,25}:\s/.test(line)) break;
    text = text ? joinLine(text, line) : line;
  }
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 600);
  return clean && !/^none\b/i.test(clean) ? [clean] : [];
}

/** Everything the store keeps from a syllabus's text besides the text itself. */
export function parseSyllabus(text: string, year: number): ParsedSyllabus {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
  const textbooks = parseTextbooks(lines);
  const firstBook = textbooks[0]?.split(/[.(]/)[0]?.trim();
  return {
    units: parseSyllabusSchedule(text, year, firstBook || undefined),
    textbooks,
    outcomes: parseOutcomes(lines),
    prerequisites: parsePrerequisites(lines),
  };
}

/** The year a results row's term names ("2026 Fall" is 2026). */
export function termYear(label: string): number | null {
  const year = /^(\d{4})\b/.exec(label.trim())?.[1];
  return year ? Number(year) : null;
}

/** A downloaded syllabus as the document the store keeps. */
export function utSyllabusDocument(
  row: UtResultRow,
  link: Extract<UtSyllabusLink, { kind: 'download' }>,
  rawText: string,
  parsed: ParsedSyllabus,
): StructureDocumentInput {
  return {
    providerSlug: UT_PROVIDER_SLUG,
    externalId: link.id,
    title: `${row.title} (${row.courseCode}, ${row.term})`,
    canonicalUrl: link.url,
    sourceUrl: link.url,
    author: row.instructors.join(', ') || null,
    institution: 'The University of Texas at Austin',
    courseCode: row.courseCode,
    term: row.term,
    licenceMode: UT_LICENCE_MODE,
    rawText,
    textbooks: parsed.textbooks,
    outcomes: parsed.outcomes,
    prerequisites: parsed.prerequisites,
    units: parsed.units,
  };
}

// ---------------------------------------------------------------------------
// Fetching

export type UtRefused = (detail: string) => void;

/** The form page, from which the department codes are read. */
export async function fetchUtForm(onRefused?: UtRefused): Promise<string | null> {
  const page = await fetchDocument(UT_FORM_URL);
  if (!page.ok) {
    onRefused?.(`${UT_FORM_URL}: ${page.reason}`);
    return null;
  }
  return page.text;
}

/** One results page, or null when it could not be fetched. */
export async function fetchUtResults(search: UtSearch, onRefused?: UtRefused): Promise<string | null> {
  const url = utSearchUrl(search);
  const page = await fetchDocument(url);
  if (!page.ok || page.contentType !== 'html') {
    onRefused?.(`${url}: ${page.ok ? 'not a page' : page.reason}`);
    return null;
  }
  return page.text;
}

/** The text of a syllabus PDF, its pages joined by a blank line, or null. */
export async function fetchUtSyllabusText(url: string, onRefused?: UtRefused): Promise<string | null> {
  const file = await fetchDocument(url);
  if (!file.ok) {
    onRefused?.(`${url}: ${file.reason}`);
    return null;
  }
  if (!file.bytes) {
    onRefused?.(`${url}: not a PDF`);
    return null;
  }
  const pages = await extractPdfPages(file.bytes);
  return pages ? pages.join('\n\n') : null;
}
