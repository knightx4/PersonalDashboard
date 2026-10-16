import 'server-only';

import type { StructureDocumentInput, StructureReading, StructureUnit } from '@/lib/learn/catalogue/structure';
import { fetchDocument } from './fetch';

/**
 * MIT OpenCourseWare, for a course's structure: its syllabus and its
 * session-by-session calendar, with the readings each session assigns and the
 * lecture notes it publishes (plan #2247.3).
 *
 * The site search is a JavaScript app that answers a fetch with nothing, so a
 * course is found by its number in the sitemap instead. `ocw.mit.edu/sitemap.xml`
 * lists one entry per course offering as
 * `/courses/<number>-<title>-<term>/sitemap.xml`, the number written with a
 * hyphen for the dot and in lower case (`15-431-…`, `11-001j-…`). One fetch of
 * it confirms that a number a model proposed is a real course and gives its
 * address.
 *
 * A course page then links the pages it has. Four are read, when linked:
 *
 *   pages/syllabus/       description, prerequisites, textbooks, outcomes
 *   pages/calendar/       one row per session: number and topics
 *   pages/readings/       the same sessions, with what each assigns
 *   pages/lecture-notes/  the same sessions, with links to the notes' PDFs
 *
 * The three session tables share their first column, so they are joined on
 * it. A row spanning the whole table is a part heading ("Business Valuation"),
 * carried into the topics of each session under it. A course with no calendar
 * page takes its sessions from whichever of the other two it has.
 *
 * Everything is CC BY-NC-SA, so the document is stored with licence mode
 * `show`. Lecture notes that say "Courtesy of … Used with permission" are
 * someone else's material inside the course, and say so in their licence.
 *
 * Every page shape is parsed by a pure function below, tested against pages
 * fetched live in lib/learn/providers/fixtures/structure/ocw/.
 */

const OCW_HOST = 'ocw.mit.edu';
const OCW_ORIGIN = `https://${OCW_HOST}`;
export const OCW_SITEMAP_URL = `${OCW_ORIGIN}/sitemap.xml`;
export const OCW_PROVIDER_SLUG = 'mit-ocw';
export const OCW_INSTITUTION = 'Massachusetts Institute of Technology';

/** The four pages a structure is read from, by their path under the course. */
export const OCW_STRUCTURE_PAGES = ['syllabus', 'calendar', 'readings', 'lecture-notes'] as const;
export type OcwStructurePage = (typeof OCW_STRUCTURE_PAGES)[number];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  eacute: 'é',
  egrave: 'è',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ccedil: 'ç',
  times: '×',
  deg: '°',
};

export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A store's "Buy at MIT Press" link, which sits inside a citation and is not part of it. */
const BUY_LINK = /<a\b[^>]*>\s*Buy at [^<]*<\/a>/gi;

/**
 * The lines of a fragment: paragraphs and `<br>` breaks become lines, tags go,
 * entities are decoded, and empty lines are dropped. The site's markup leaves
 * stray `<p>` and `</p>` around table cells, so a line is whatever text falls
 * between any two of them.
 */
export function htmlLines(html: string): string[] {
  const text = html
    .replace(BUY_LINK, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|thead|tbody)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeHtml(text)
    .split('\n')
    .map(squash)
    .filter((line) => line !== '');
}

/** The page's own content, without the site's nav, banner and footer. */
export function mainSection(html: string): string | null {
  const start = html.search(/<main\b[^>]*id="course-content-section"[^>]*>/);
  if (start < 0) return null;
  const end = html.indexOf('</main>', start);
  return html.slice(start, end < 0 ? undefined : end);
}

/**
 * A page's content as plain text, which is what the document keeps as its raw
 * text: blocks on their own lines, and each table row on one line with its
 * cells joined by a bar ("3 | Discounted cash flow (DCF) and the venture
 * capital method"). A cell's own lines are joined with a slash, since the
 * site's stray paragraph tags would otherwise break a row over several lines.
 */
export function plainText(html: string): string {
  const lines: string[] = [];
  let at = 0;
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    lines.push(...htmlLines(html.slice(at, table.index)));
    for (const tr of table[1].split(/<tr\b[^>]*>/i).slice(1)) {
      const row = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => htmlLines(cell[1]).join(' / '))
        .filter((cell) => cell !== '')
        .join(' | ');
      if (row) lines.push(row);
    }
    at = table.index + table[0].length;
  }
  lines.push(...htmlLines(html.slice(at)));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Finding a course by its number
// ---------------------------------------------------------------------------

/**
 * A course number as MIT writes it, upper case: `15.431`, `11.001J`, `6.006`,
 * `18.06SC`, `STS.001`, `CMS.611J`. Null for anything else.
 */
export function normaliseCourseNumber(raw: string): string | null {
  const value = raw
    .trim()
    .replace(/^course\s+/i, '')
    .replace(/^(\w+)-(\w+)$/, '$1.$2')
    .toUpperCase();
  return /^([0-9]{1,2}[A-Z]?|[A-Z]{2,4})\.[0-9]{1,4}[A-Z]{0,3}$/.test(value) ? value : null;
}

/** `15.431` to `15-431`, the form a course's address starts with. */
export function courseNumberSlug(number: string): string {
  return number.toLowerCase().replace('.', '-');
}

const TERM_ORDER: Record<string, number> = { january: 0, iap: 0, spring: 1, summer: 2, fall: 3 };

/** The term at the end of a course address: `…-spring-2011` is Spring 2011. */
export function termFromSlug(slug: string): { term: string; sortKey: number } | null {
  const match = slug.match(/-(spring|summer|fall|january|iap)-((?:19|20)\d\d)$/i);
  if (!match) return null;
  const season = match[1].toLowerCase();
  const name = season === 'iap' ? 'IAP' : season[0].toUpperCase() + season.slice(1);
  return { term: `${name} ${match[2]}`, sortKey: Number(match[2]) * 10 + (TERM_ORDER[season] ?? 0) };
}

export type OcwOffering = { courseUrl: string; slug: string; term: string | null };

/**
 * Every offering of a course number in the sitemap, newest first.
 *
 * The slug must start with the number and a hyphen, so `18.06` finds
 * `18-06-linear-algebra-…` and not `18-065-…` or `18-06sc-…`. A number given
 * without its `J` (cross-listed subjects carry one) still finds the `J` course.
 */
export function offeringsFromSitemap(xml: string, number: string): OcwOffering[] {
  const slug = courseNumberSlug(number);
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withJ = /j$/.test(slug) ? '' : 'j?';
  const pattern = new RegExp(`^${escaped}${withJ}-[a-z0-9-]+$`);
  const seen = new Set<string>();
  const offerings: (OcwOffering & { sortKey: number })[] = [];

  for (const match of xml.matchAll(/<loc>\s*https:\/\/ocw\.mit\.edu\/courses\/([^/<\s]+)\/(?:sitemap\.xml)?\s*<\/loc>/g)) {
    const courseSlug = match[1].toLowerCase();
    if (!pattern.test(courseSlug) || seen.has(courseSlug)) continue;
    seen.add(courseSlug);
    const term = termFromSlug(courseSlug);
    offerings.push({
      courseUrl: `${OCW_ORIGIN}/courses/${courseSlug}/`,
      slug: courseSlug,
      term: term?.term ?? null,
      sortKey: term?.sortKey ?? 0,
    });
  }

  return offerings
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ courseUrl, slug: s, term }) => ({ courseUrl, slug: s, term }));
}

// ---------------------------------------------------------------------------
// The course page
// ---------------------------------------------------------------------------

export type OcwCourseInfo = {
  title: string;
  /** As the banner prints it: `15.431`, `11.001J`. */
  courseNumber: string | null;
  term: string | null;
  level: string | null;
  instructors: string[];
  description: string | null;
  /** The structure pages this course links, by name, as full addresses. */
  pages: Partial<Record<OcwStructurePage, string>>;
};

/** The course's title, number, term, instructors and which of the four pages it has. */
export function courseInfoFromPage(html: string, courseUrl: string): OcwCourseInfo | null {
  const banner = html.match(/<span class="course-number-term-detail">([^<]*)<\/span>/);
  const heading = html.match(/<h1>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h1>/);
  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/);
  const title = heading
    ? squash(decodeHtml(heading[1].replace(/<[^>]+>/g, '')))
    : ogTitle
      ? squash(decodeHtml(ogTitle[1]).split('|')[0])
      : '';
  if (!title) return null;

  const [number, term, level] = (banner ? decodeHtml(banner[1]) : '').split('|').map(squash);

  const instructors: string[] = [];
  for (const match of html.matchAll(/class="course-info-instructor[^"]*"[^>]*>([^<]+)</g)) {
    const name = squash(decodeHtml(match[1]));
    if (name && !instructors.includes(name)) instructors.push(name);
  }

  const described = html.match(/"description":\s*"((?:[^"\\]|\\.)*)"/);
  let description: string | null = null;
  if (described) {
    try {
      // The description is Markdown; its emphasis marks are not part of the words.
      const words = (JSON.parse(`"${described[1]}"`) as string).replace(/(^|[\s(])[_*]+([^_*]+?)[_*]+(?=[\s.,;:)]|$)/g, '$1$2');
      description = squash(words) || null;
    } catch {
      description = null;
    }
  }

  const base = new URL(courseUrl);
  const coursePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const pages: OcwCourseInfo['pages'] = {};
  for (const page of OCW_STRUCTURE_PAGES) {
    const path = `${coursePath}pages/${page}/`;
    if (html.includes(`href="${path}"`)) pages[page] = `${OCW_ORIGIN}${path}`;
  }

  return {
    title,
    courseNumber: number ? normaliseCourseNumber(number) ?? number : null,
    term: term || null,
    level: level || null,
    instructors,
    description,
    pages,
  };
}

// ---------------------------------------------------------------------------
// Session tables
// ---------------------------------------------------------------------------

type SessionRow = { key: string; cells: Record<string, string>; part: string | null };

export type SessionTable = {
  /** What the first column is called, lower case: `ses #`, `lec #`, `week`. */
  keyHeader: string;
  rows: SessionRow[];
};

/**
 * The session table on a calendar, readings or lecture-notes page.
 *
 * Each row's cells come back by their column's header in lower case, as raw
 * HTML, so a caller can read text or links out of them. A row with one cell
 * spanning the table is a part heading and is not a row: it is the `part` of
 * the rows after it. A row whose first cell is empty is skipped.
 */
export function sessionTable(html: string): SessionTable | null {
  const main = mainSection(html) ?? html;
  const rows: SessionRow[] = [];
  let keyHeader: string | null = null;

  for (const table of main.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = table[1];
    const headers = [...body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
      htmlLines(m[1]).join(' ').toLowerCase(),
    );
    if (headers.length < 2) continue;
    // A grading table (ACTIVITIES | PERCENTAGES) is not a session table.
    if (!/#|^(ses|lec|week|class|day|unit|session|lecture)/.test(headers[0])) continue;
    keyHeader ??= headers[0];

    let part: string | null = null;
    for (const tr of body.split(/<tr\b[^>]*>/i).slice(1)) {
      const cells = [...tr.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
      if (cells.length === 0) continue;
      const spans = Number(cells[0][1].match(/colspan="(\d+)"/)?.[1] ?? 1);
      if (cells.length === 1 && spans > 1) {
        part = htmlLines(cells[0][2]).join(' ') || null;
        continue;
      }
      const key = htmlLines(cells[0][2]).join(' ');
      if (!key) continue;
      const byHeader: Record<string, string> = {};
      cells.forEach((cell, i) => {
        if (headers[i]) byHeader[headers[i]] = cell[2];
      });
      rows.push({ key, cells: byHeader, part });
    }
  }

  return keyHeader ? { keyHeader, rows } : null;
}

function column(cells: Record<string, string>, pattern: RegExp): string | null {
  const name = Object.keys(cells).find((header) => pattern.test(header));
  return name ? cells[name] : null;
}

const TOPICS_COLUMN = /topic/;
const READINGS_COLUMN = /reading/;

/** "Session 3" for a row keyed `3` under `SES #`; the key itself when it is not a number. */
export function sessionLabel(keyHeader: string, key: string): string {
  if (!/^\d+[A-Z]?$/i.test(key)) return key;
  if (/^ses/.test(keyHeader) || /^session/.test(keyHeader)) return `Session ${key}`;
  if (/^lec/.test(keyHeader)) return `Lecture ${key}`;
  if (/^week/.test(keyHeader)) return `Week ${key}`;
  if (/^class/.test(keyHeader)) return `Class ${key}`;
  if (/^day/.test(keyHeader)) return `Day ${key}`;
  if (/^unit/.test(keyHeader)) return `Unit ${key}`;
  return `Session ${key}`;
}

/** A link to one of the course's own resource pages, which is how OCW serves a PDF. */
export type OcwResourceLink = { url: string; text: string; courtesy: string | null };

/**
 * The course's own resource pages linked from a cell: lecture notes, slides.
 * Only links under this course's `/resources/`, so a link to another course or
 * to a shop is never taken for its material.
 */
export function resourceLinks(cellHtml: string, courseUrl: string): OcwResourceLink[] {
  const coursePath = new URL(courseUrl).pathname.replace(/\/?$/, '/');
  const courtesy = squash(decodeHtml(cellHtml.replace(/<[^>]+>/g, ' '))).match(
    /\(?(Courtesy of [^)]*?Used with permission\.?)\)?/i,
  );
  const links: OcwResourceLink[] = [];
  for (const match of cellHtml.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeHtml(match[1]), OCW_ORIGIN);
    } catch {
      continue;
    }
    if (url.hostname !== OCW_HOST || !url.pathname.startsWith(`${coursePath}resources/`)) continue;
    url.protocol = 'https:';
    url.hash = '';
    url.search = '';
    const href = url.toString();
    if (links.some((link) => link.url === href)) continue;
    links.push({ url: href, text: squash(decodeHtml(match[2].replace(/<[^>]+>/g, ''))) || 'PDF', courtesy: courtesy?.[1] ?? null });
  }
  return links;
}

/** A cell's text with its resource links and their brackets taken out: "Ways of Seeing the City (PDF - 1.1 MB)" reads "Ways of Seeing the City". */
function withoutLinks(cellHtml: string): string {
  return cellHtml.replace(/\(\s*<a\b[^>]*>[\s\S]*?<\/a>\s*\)/gi, '').replace(/<a\b[^>]*>\s*PDF[^<]*<\/a>/gi, '');
}

/** The readings a cell assigns, one per paragraph, each a full citation. */
export function readingsFromCell(cellHtml: string): StructureReading[] {
  return htmlLines(cellHtml)
    .filter((line) => !/^(none|n\/a|-+)$/i.test(line))
    .map((title) => ({ title }));
}

export type OcwNote = {
  /** The unit it belongs to, by its position in the units. */
  unitIndex: number;
  sessionLabel: string;
  heading: string;
  url: string;
  linkText: string;
  courtesy: string | null;
};

export type OcwSessions = { units: StructureUnit[]; notes: OcwNote[] };

/**
 * The course's sessions as ordered units, from its calendar joined to its
 * readings and lecture-notes pages on the session number.
 *
 * The heading is the first line of the session's topics, the topics are its
 * part heading and the rest of those lines, and the readings are what the
 * readings page assigns followed by the session's lecture notes. Whichever of
 * the three pages is given first and has rows sets the order; the others only
 * add to sessions it already has.
 */
export function sessionsFromPages(
  pages: { calendar?: string | null; readings?: string | null; lectureNotes?: string | null },
  courseUrl: string,
): OcwSessions {
  const calendar = pages.calendar ? sessionTable(pages.calendar) : null;
  const readings = pages.readings ? sessionTable(pages.readings) : null;
  const notesPage = pages.lectureNotes ? sessionTable(pages.lectureNotes) : null;
  const spine = [calendar, readings, notesPage].find((table) => table && table.rows.length > 0);
  if (!spine) return { units: [], notes: [] };

  const byKey = (table: SessionTable | null) => {
    const map = new Map<string, SessionRow>();
    for (const row of table?.rows ?? []) if (!map.has(row.key)) map.set(row.key, row);
    return map;
  };
  const readingRows = byKey(readings);
  const noteRows = byKey(notesPage);

  const units: StructureUnit[] = [];
  const notes: OcwNote[] = [];
  const seen = new Set<string>();

  for (const row of spine.rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);

    const label = sessionLabel(spine.keyHeader, row.key);
    const topicsCell = column(row.cells, TOPICS_COLUMN) ?? Object.values(row.cells)[1] ?? '';
    const lines = htmlLines(withoutLinks(topicsCell)).map((line) => line.replace(/^[-–•]\s*/, ''));
    // A week that lists its lectures one per line ("Lecture 1: Introduction",
    // "Lecture 2: Data Structures", as 6.006 does) is headed by all of them,
    // since no one lecture is the week.
    const lectureList = lines.length > 1 && lines.every((line) => /^(lecture|lec|session|class)\s*\d+\b/i.test(line));
    const heading = lectureList ? lines.join('; ') : (lines[0] ?? '').replace(/:$/, '') || label;
    const topics = [...(row.part ? [row.part] : []), ...(lectureList ? [] : lines.slice(1))];

    const assigned = column(readingRows.get(row.key)?.cells ?? {}, READINGS_COLUMN);
    const unitReadings = assigned ? readingsFromCell(assigned) : [];

    // Notes may sit in their own column (15.431) or inside the topics cell
    // (11.001J), so every cell of the session's lecture-notes row is read, and
    // the calendar's own row too.
    const noteCells = [...Object.values(noteRows.get(row.key)?.cells ?? {}), ...Object.values(row.cells)];
    const links: OcwResourceLink[] = [];
    for (const cell of noteCells) {
      for (const link of resourceLinks(cell, courseUrl)) {
        if (!links.some((known) => known.url === link.url)) links.push(link);
      }
    }

    const unitIndex = units.length;
    for (const link of links) {
      unitReadings.push({ title: 'Lecture notes', detail: link.text, url: link.url });
      notes.push({ unitIndex, sessionLabel: label, heading, url: link.url, linkText: link.text, courtesy: link.courtesy });
    }

    units.push({ label, heading, topics, readings: unitReadings });
  }

  return { units, notes };
}

// ---------------------------------------------------------------------------
// The syllabus
// ---------------------------------------------------------------------------

export type OcwSyllabus = { prerequisites: string[]; textbooks: string[]; outcomes: string[] };

/** The syllabus's sections, by heading, each as its lines. */
function syllabusSections(html: string): { heading: string; lines: string[]; html: string }[] {
  const main = mainSection(html) ?? html;
  const parts = main.split(/<h[2-4]\b[^>]*>/i);
  return parts.slice(1).map((part) => {
    const close = part.search(/<\/h[2-4]>/i);
    const heading = squash(decodeHtml(part.slice(0, close).replace(/<[^>]+>/g, '')));
    const rest = part.slice(close < 0 ? 0 : part.indexOf('>', close) + 1);
    return { heading, lines: htmlLines(rest), html: rest };
  });
}

/**
 * What the syllabus says about prerequisites, textbooks and outcomes, each as
 * the syllabus words it.
 *
 * - Prerequisites: the lines of a section headed "Prerequisite(s)", or else
 *   any line anywhere that names a prerequisite.
 * - Textbooks: in a section headed "Materials", "Textbooks", "Texts" or
 *   "Readings", the lines that cite a book (an ISBN or an italic title).
 * - Outcomes: the lines of a section headed for objectives, outcomes or goals.
 */
export function syllabusFromPage(html: string): OcwSyllabus {
  const sections = syllabusSections(html);

  const prereqSection = sections.find((section) => /prerequisite|pre-requisite/i.test(section.heading));
  const prerequisites = prereqSection
    ? prereqSection.lines
    : sections.flatMap((section) => section.lines).filter((line) => /\bpre-?requisite/i.test(line));

  const textbooks: string[] = [];
  for (const section of sections.filter((s) => /material|textbook|\btexts?\b|reading/i.test(s.heading))) {
    for (const paragraph of section.html.split(/<\/p>|<p\b[^>]*>|<li\b[^>]*>/i)) {
      if (!/ISBN|<em>/i.test(paragraph)) continue;
      const line = htmlLines(paragraph).join(' ');
      if (line && !textbooks.includes(line)) textbooks.push(line);
    }
  }

  const outcomes = sections
    .filter((section) => /objective|outcome|learning goal|course goal/i.test(section.heading))
    .flatMap((section) => section.lines);

  return { prerequisites, textbooks, outcomes };
}

// ---------------------------------------------------------------------------
// The whole course
// ---------------------------------------------------------------------------

/** One lecture-note PDF the course publishes, as a catalogue item of its own. */
export type OcwMaterial = {
  externalId: string;
  title: string;
  canonicalUrl: string;
  /** The session it belongs to, verbatim: "Session 3". */
  providerLabel: string;
  /** Null when it follows the course's licence; a sentence when it does not. */
  licence: string | null;
};

export type OcwCourseStructure = { document: StructureDocumentInput; material: OcwMaterial[] };

export type OcwCoursePages = {
  courseUrl: string;
  course: string;
  syllabus?: string | null;
  calendar?: string | null;
  readings?: string | null;
  lectureNotes?: string | null;
};

const PAGE_TITLES: Record<OcwStructurePage, string> = {
  syllabus: 'Syllabus',
  calendar: 'Calendar',
  readings: 'Readings',
  'lecture-notes': 'Lecture Notes',
};

/**
 * A course's pages, as fetched, into the document the store keeps and the
 * lecture notes it lists. Null when the course page cannot be read or no page
 * has a session table, since a course with no sessions has no structure to
 * keep.
 */
export function courseStructureFromPages(pages: OcwCoursePages): OcwCourseStructure | null {
  const info = courseInfoFromPage(pages.course, pages.courseUrl);
  if (!info) return null;

  const { units, notes } = sessionsFromPages(
    { calendar: pages.calendar, readings: pages.readings, lectureNotes: pages.lectureNotes },
    pages.courseUrl,
  );
  if (units.length === 0) return null;

  const syllabus = pages.syllabus ? syllabusFromPage(pages.syllabus) : { prerequisites: [], textbooks: [], outcomes: [] };

  const bodies: [OcwStructurePage, string | null | undefined][] = [
    ['syllabus', pages.syllabus],
    ['calendar', pages.calendar],
    ['readings', pages.readings],
    ['lecture-notes', pages.lectureNotes],
  ];
  const header = [info.courseNumber, info.title, info.term].filter(Boolean).join(' | ');
  const rawText = [
    header,
    ...(info.description ? [info.description] : []),
    ...bodies
      .filter(([, body]) => body)
      .map(([page, body]) => `${PAGE_TITLES[page]}\n${plainText(mainSection(body!) ?? body!)}`),
  ].join('\n\n');

  const slug = new URL(pages.courseUrl).pathname.split('/').filter(Boolean)[1] ?? pages.courseUrl;
  const number = info.courseNumber ?? '';
  const sourceUrl = info.pages.calendar ?? info.pages.readings ?? info.pages['lecture-notes'] ?? pages.courseUrl;

  const document: StructureDocumentInput = {
    providerSlug: OCW_PROVIDER_SLUG,
    externalId: slug,
    title: info.title,
    canonicalUrl: pages.courseUrl,
    sourceUrl,
    author: info.instructors.length > 0 ? info.instructors.join(', ') : null,
    institution: OCW_INSTITUTION,
    courseCode: info.courseNumber,
    term: info.term,
    licenceMode: 'show',
    rawText,
    textbooks: syllabus.textbooks,
    outcomes: syllabus.outcomes,
    prerequisites: syllabus.prerequisites,
    units,
  };

  const material: OcwMaterial[] = [];
  for (const note of notes) {
    const resource = new URL(note.url).pathname.split('/').filter(Boolean).pop() ?? note.url;
    const externalId = `${slug}/resources/${resource}`;
    if (material.some((item) => item.externalId === externalId)) continue;
    material.push({
      externalId,
      title: `${number ? `${number} ` : ''}lecture notes, ${note.sessionLabel.toLowerCase()}: ${note.heading}`.slice(0, 500),
      canonicalUrl: note.url,
      providerLabel: note.sessionLabel,
      licence: note.courtesy,
    });
  }

  return { document, material };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Told when ocw.mit.edu would not hand over a page, so a caller can say the site refused. */
export type OcwStructureRefused = (detail: string) => void;

async function getText(url: string, onRefused?: OcwStructureRefused): Promise<string | null> {
  const fetched = await fetchDocument(url);
  if (!fetched.ok) {
    onRefused?.(`${url}: ${fetched.reason}, ${fetched.detail}`);
    return null;
  }
  if (fetched.contentType === 'pdf' || fetched.contentType === 'json') return null;
  return fetched.text;
}

/**
 * The sitemap, read once per run and shared by every number looked up in it.
 * About 360 KB, one fetch.
 */
export function ocwSitemapReader(onRefused?: OcwStructureRefused): () => Promise<string | null> {
  let sitemap: Promise<string | null> | null = null;
  return () => (sitemap ??= getText(OCW_SITEMAP_URL, onRefused));
}

export type OcwCourseFound = { number: string; offering: OcwOffering } | { number: string; offering: null };

/**
 * Confirm course numbers against the sitemap: each comes back with its newest
 * offering, or with none when the site has no such course. A number that is
 * not written like one is dropped.
 */
export async function findOcwCourses(
  numbers: readonly string[],
  readSitemap: () => Promise<string | null>,
): Promise<OcwCourseFound[]> {
  const wanted = [...new Set(numbers.map(normaliseCourseNumber).filter((n): n is string => n !== null))];
  if (wanted.length === 0) return [];
  const sitemap = await readSitemap();
  if (!sitemap) return wanted.map((number) => ({ number, offering: null }));
  return wanted.map((number) => ({ number, offering: offeringsFromSitemap(sitemap, number)[0] ?? null }));
}

/**
 * Fetch one course's pages and read them into its structure. Five fetches at
 * most: the course page, then the four structure pages it links.
 */
export async function fetchOcwCourseStructure(
  courseUrl: string,
  onRefused?: OcwStructureRefused,
): Promise<OcwCourseStructure | null> {
  const course = await getText(courseUrl, onRefused);
  if (!course) return null;
  const info = courseInfoFromPage(course, courseUrl);
  if (!info) return null;

  const read = (page: OcwStructurePage) => (info.pages[page] ? getText(info.pages[page]!, onRefused) : null);
  const [syllabus, calendar, readings, lectureNotes] = await Promise.all([
    read('syllabus'),
    read('calendar'),
    read('readings'),
    read('lecture-notes'),
  ]);

  return courseStructureFromPages({ courseUrl, course, syllabus, calendar, readings, lectureNotes });
}
