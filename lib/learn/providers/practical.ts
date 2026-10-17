import 'server-only';

import type { LicenceMode, StructureDocumentInput, StructureReading, StructureUnit } from '@/lib/learn/catalogue/structure';
import { fetchDocument } from './fetch';
import { extractPdfPages } from './pdf-text';

/**
 * Extension short courses and certification syllabi for practical skills
 * (plan #2247.7).
 *
 * A skill taught outside universities has its structure in one of two places:
 * a cooperative extension's short course page, which lists numbered lessons
 * with a video and a handout each, and an association's examination outline,
 * a PDF whose headed sections are the domains the exam covers and whose
 * tasks say what a certified person can do. A skill practised in business
 * rather than taught by an extension service has a third place (plan
 * #2247.6): a practitioner's long guide, whose headed sections are the
 * curriculum operators actually learn from.
 *
 * Both are pulled from an allowlist in code, `PRACTICAL_SOURCES`, as the
 * explainers are (./explainers.ts): an address on no entry is refused before
 * anything is fetched, and the entry's parser says what the address yields.
 * To grow the list add an entry, a parser and a fixture saved from a live
 * fetch in fixtures/structure/practical/.
 *
 * Licence mode is per entry, and `structure_only` unless the document states
 * its terms. None of them does: the course page carries only the university's
 * copyright line, the outline PDF none, and the two practitioner articles
 * their publishers' copyright, so all keep the order, the headings and the
 * tasks, and show or feed nothing.
 *
 * The parsers are pure functions of the page text, or of the text a PDF
 * yields. The fetch path is ./fetch, which refuses private addresses on every
 * hop and reads at most 8 MB, so a handout over that is recorded as not
 * fetched and the lesson keeps its link. Nothing here writes.
 */

export type PracticalSource = {
  /** The catalogue provider the documents are stored under (migration 0161). */
  providerSlug: string;
  host: string;
  licenceMode: LicenceMode;
  /** The addresses it reads, as the proposing call is told them. */
  pages: string[];
  accepts: (url: URL) => boolean;
  pull: (url: URL) => Promise<PracticalResult>;
};

export type PracticalFailure = {
  ok: false;
  reason: 'not-allowlisted' | 'fetch-failed' | 'unparseable';
  detail: string;
};
export type PracticalResult = { ok: true; document: StructureDocumentInput } | PracticalFailure;

function failure(reason: PracticalFailure['reason'], detail: string): PracticalFailure {
  return { ok: false, reason, detail };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&apos;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function plain(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// An extension short course page: University of Arkansas, uaex.uada.edu

const UAEX_HOST = 'www.uaex.uada.edu';
export const UAEX_BEEKEEPING_URL = `https://${UAEX_HOST}/farm-ranch/special-programs/beekeeping/beekeepingshortcourse.aspx`;
/** A course has a few dozen lessons at most. Runaway guard for a page that changes shape. */
const MAX_LESSONS = 60;
/** How much of one handout's text is kept in the document's raw text. */
const MAX_HANDOUT_CHARS = 20_000;

export type ExtensionLesson = {
  /** "Part 4", or null for an introduction the page does not number. */
  label: string | null;
  /** The lesson number, 0 for an unnumbered introduction. */
  number: number;
  title: string;
  videoUrl: string;
  /** The handout PDF for this lesson, when the page lists one. */
  handoutUrl: string | null;
};

export type ExtensionCourse = {
  title: string;
  /** The page's own description, one paragraph per line. */
  overview: string;
  /** A list under a "learning objectives" style heading, when the page has one. */
  outcomes: string[];
  lessons: ExtensionLesson[];
  /** The one handout covering every lesson, when listed. */
  allHandoutUrl: string | null;
};

const OUTCOMES_HEADING = /^(learning (objectives|outcomes)|course objectives|what you(?:'|’)ll learn|you will learn)/i;

/**
 * An extension course page: the title, the overview, and the lessons in the
 * order the page lists them. A lesson is a video link whose `title` reads
 * "Part N: Title" (an unnumbered video before Part 1 is the introduction);
 * the handouts are the PDF links whose text is "Part N", matched to a lesson
 * by number. Only YouTube video links and same-host PDFs are taken.
 */
export function parseExtensionCourse(html: string, pageUrl: string): ExtensionCourse {
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = pageTitle ? plain(pageTitle) : '';

  const start = html.search(/<h1\b/i);
  const body = (start >= 0 ? html.slice(start) : html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const overview: string[] = [];
  for (const match of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (/<a\b[^>]*href="https:\/\/www\.youtube\.com\/watch/i.test(match[1])) continue;
    const text = plain(match[1]);
    if (text.length >= 80) overview.push(text);
  }

  const outcomes: string[] = [];
  const headingMatch = [...body.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>\s*(?:<p\b[^>]*>[\s\S]*?<\/p>\s*)?<ul\b[^>]*>([\s\S]*?)<\/ul>/gi)].find(
    (match) => OUTCOMES_HEADING.test(plain(match[1])),
  );
  if (headingMatch) {
    for (const item of headingMatch[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = plain(item[1]);
      if (text) outcomes.push(text);
    }
  }

  const handouts = new Map<number, string>();
  let allHandoutUrl: string | null = null;
  for (const match of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href="([^"]+)"/i.exec(match[1])?.[1];
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(href), pageUrl);
    } catch {
      continue;
    }
    if (url.hostname !== UAEX_HOST || !url.pathname.toLowerCase().endsWith('.pdf')) continue;
    const text = plain(match[2]);
    const part = /^Part\s+(\d+)$/i.exec(text);
    if (part) handouts.set(Number(part[1]), url.href);
    else if (/^all parts$/i.test(text)) allHandoutUrl = url.href;
  }

  const lessons: ExtensionLesson[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/<a\b([^>]*)>/gi)) {
    const href = /href="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+)"/i.exec(match[1])?.[1];
    const rawTitle = /\btitle="([^"]*)"/i.exec(match[1])?.[1];
    if (!href || !rawTitle || seen.has(href)) continue;
    const text = decodeEntities(rawTitle).replace(/^"(.*)"$/, '$1').trim();
    const part = /^Part\s+(\d+):\s*(.+)$/i.exec(text);
    // A video link that is neither numbered nor before Part 1 is not a lesson.
    if (!part && lessons.length > 0) continue;
    seen.add(href);
    const number = part ? Number(part[1]) : 0;
    lessons.push({
      label: part ? `Part ${number}` : null,
      number,
      title: part ? part[2].trim() : text,
      videoUrl: decodeEntities(href),
      handoutUrl: part ? (handouts.get(number) ?? null) : null,
    });
    if (lessons.length >= MAX_LESSONS) break;
  }

  return { title, overview: overview.join('\n'), outcomes, lessons, allHandoutUrl };
}

/** What the document keeps of one lesson's handout. Pure, so it can be tested without a PDF. */
function handoutText(pages: string[]): string {
  return pages.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_HANDOUT_CHARS);
}

/** The course as the document the store keeps. `handouts` maps a lesson number to its extracted text. */
export function extensionDocument(
  course: ExtensionCourse,
  pageUrl: URL,
  handouts: Map<number, string>,
  unreadable: number[],
): StructureDocumentInput {
  const units: StructureUnit[] = course.lessons.map((lesson) => {
    const readings: StructureReading[] = [{ title: `${lesson.title} (video)`, url: lesson.videoUrl }];
    if (lesson.handoutUrl) readings.push({ title: `${lesson.title} (handout)`, url: lesson.handoutUrl });
    return { label: lesson.label, heading: lesson.title, topics: [], readings };
  });

  const raw: string[] = [course.title, pageUrl.href, course.overview];
  for (const lesson of course.lessons) {
    raw.push(`${lesson.label ?? 'Introduction'}: ${lesson.title}\n${lesson.videoUrl}${lesson.handoutUrl ? `\n${lesson.handoutUrl}` : ''}`);
    const text = handouts.get(lesson.number);
    if (text) raw.push(`Handout, ${lesson.label ?? 'introduction'}:\n${text}`);
  }
  if (unreadable.length > 0) {
    raw.push(`Handouts not read (over the fetch limit or not text): ${unreadable.map((n) => `Part ${n}`).join(', ')}`);
  }

  const slug = pageUrl.pathname.split('/').pop()!.replace(/\.aspx$/i, '');
  return {
    providerSlug: 'uaex',
    externalId: slug,
    title: course.title,
    canonicalUrl: pageUrl.href,
    sourceUrl: pageUrl.href,
    author: 'University of Arkansas System Division of Agriculture, Cooperative Extension Service',
    institution: 'University of Arkansas System Division of Agriculture',
    licenceMode: 'structure_only',
    rawText: raw.filter((part) => part !== '').join('\n\n'),
    outcomes: course.outcomes,
    units,
  };
}

async function pullExtensionCourse(pageUrl: URL): Promise<PracticalResult> {
  const page = await fetchDocument(pageUrl.href);
  if (!page.ok) return failure('fetch-failed', `${page.reason}: ${page.detail}`);
  const course = parseExtensionCourse(page.text, pageUrl.href);
  if (!course.title || course.lessons.length === 0) {
    return failure('unparseable', 'No lessons in the extension course page.');
  }

  // Handouts are read where they can be: a slide deck over the fetch limit, or
  // one with no text layer, leaves its lesson with the link only.
  const handouts = new Map<number, string>();
  const unreadable: number[] = [];
  for (const lesson of course.lessons) {
    if (!lesson.handoutUrl) continue;
    const pdf = await fetchDocument(lesson.handoutUrl);
    const pages = pdf.ok && pdf.bytes ? await extractPdfPages(pdf.bytes) : null;
    const text = pages ? handoutText(pages) : '';
    if (text) handouts.set(lesson.number, text);
    else unreadable.push(lesson.number);
  }
  return { ok: true, document: extensionDocument(course, pageUrl, handouts, unreadable) };
}

// ---------------------------------------------------------------------------
// A certification examination outline PDF: ISA Certified Arborist

const ISA_HOST = 'www.isa-arbor.com';
export const ISA_CERTIFIED_ARBORIST_URL = `https://${ISA_HOST}/Portals/0/Assets/PDF/Certification-Applications/Cert-Exam-Outline-CA.pdf`;

export type ExamTask = { letter: string; statement: string; knowledge: string[] };
export type ExamDomain = { name: string; weight: number; tasks: ExamTask[] };
export type ExamOutline = { domains: ExamDomain[] };

const DOMAIN_LINE = /^(.+?)\s+Weight:\s*(\d{1,3})\s*%$/;
const TASK_LINE = /^Task\s+([A-Z]):\s*(.+)$/;
const ITEM_LINE = /^(\d{1,2})\.\s*(.*)$/;
const NOISE_LINE = /^(Knowledge of:?(\s+Skill in:?)?|Skill in:?|Based on Job Task Analysis.*)$/;

/** Join a wrapped line onto the one before it: a trailing hyphen closes up, anything else takes a space. */
function joinWrapped(before: string, next: string): string {
  return /[a-z]-$/.test(before) ? `${before}${next}` : `${before} ${next}`;
}

/**
 * An examination outline from the text of its PDF, as the extractor returns it
 * (one string, lines in reading order, pages in order). A domain is a line
 * ending "Weight: N%"; under it, each "Task A: ..." line opens a task whose
 * statement may wrap onto the next lines. The numbered lists that follow a
 * task are its "Knowledge of" list and then its "Skill in" list, each starting
 * again at 1, and the first is kept as the task's knowledge. Text before the
 * first domain (the program description and the table of domain weights) is
 * ignored, as is each page's footer.
 */
export function parseExamOutline(text: string): ExamOutline {
  const domains: ExamDomain[] = [];
  let domain: ExamDomain | null = null;
  let task: ExamTask | null = null;
  let listIndex = 0; // which numbered list of the task is being read, 1-based
  let statementOpen = false;
  let lastItem: { list: string[]; index: number } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (NOISE_LINE.test(line)) {
      statementOpen = false;
      continue;
    }
    const domainMatch = DOMAIN_LINE.exec(line);
    if (domainMatch) {
      domain = { name: domainMatch[1].trim(), weight: Number(domainMatch[2]), tasks: [] };
      domains.push(domain);
      task = null;
      statementOpen = false;
      lastItem = null;
      continue;
    }
    if (!domain) continue;
    const taskMatch = TASK_LINE.exec(line);
    if (taskMatch) {
      task = { letter: taskMatch[1], statement: taskMatch[2].trim(), knowledge: [] };
      domain.tasks.push(task);
      listIndex = 0;
      statementOpen = true;
      lastItem = null;
      continue;
    }
    if (!task) continue;
    const item = ITEM_LINE.exec(line);
    if (item) {
      statementOpen = false;
      if (item[1] === '1') listIndex += 1;
      lastItem = null;
      if (listIndex === 1) {
        task.knowledge.push(item[2].trim());
        lastItem = { list: task.knowledge, index: task.knowledge.length - 1 };
      }
      continue;
    }
    if (statementOpen) {
      task.statement = joinWrapped(task.statement, line);
    } else if (lastItem) {
      lastItem.list[lastItem.index] = joinWrapped(lastItem.list[lastItem.index], line);
    }
  }
  // The extractor reads a page's blocks in its own order (the last page of the
  // ISA outline yields task E before C and D), and the tasks are lettered, so
  // the letter is the order.
  for (const entry of domains) entry.tasks.sort((a, b) => a.letter.localeCompare(b.letter));
  return { domains: domains.filter((candidate) => candidate.tasks.length > 0) };
}

/** The outline as the document the store keeps: one unit per domain, the tasks as the document's outcomes. */
export function examDocument(outline: ExamOutline, pdfUrl: URL, rawText: string): StructureDocumentInput {
  const file = pdfUrl.pathname.split('/').pop()!.replace(/\.pdf$/i, '');
  return {
    providerSlug: 'isa-arbor',
    externalId: file.toLowerCase(),
    title: 'ISA Certified Arborist examination outline',
    canonicalUrl: pdfUrl.href,
    sourceUrl: pdfUrl.href,
    author: 'International Society of Arboriculture',
    institution: 'International Society of Arboriculture',
    licenceMode: 'structure_only',
    rawText,
    outcomes: outline.domains.flatMap((domain) =>
      domain.tasks.map((task) => `${domain.name}, task ${task.letter}: ${task.statement}`),
    ),
    units: outline.domains.map((domain) => ({
      label: `${domain.weight}% of the exam`,
      heading: domain.name,
      topics: domain.tasks.flatMap((task) => [task.statement, ...task.knowledge]),
      readings: [],
    })),
  };
}

async function pullExamOutline(pdfUrl: URL): Promise<PracticalResult> {
  const pdf = await fetchDocument(pdfUrl.href);
  if (!pdf.ok) return failure('fetch-failed', `${pdf.reason}: ${pdf.detail}`);
  if (!pdf.bytes) return failure('unparseable', 'The address did not return a PDF.');
  const pages = await extractPdfPages(pdf.bytes);
  if (!pages) return failure('unparseable', 'The PDF has no text layer or could not be read.');
  const rawText = pages.join('\n\n');
  const outline = parseExamOutline(rawText);
  if (outline.domains.length === 0) return failure('unparseable', 'No domains with tasks in the examination outline.');
  return { ok: true, document: examDocument(outline, pdfUrl, rawText) };
}

// ---------------------------------------------------------------------------
// A practitioner's guide: one long article whose headings lay a skill out
// (plan #2247.6). David Skok's SaaS Metrics 2.0 and a16z's 16 Startup Metrics
// are how SaaS metrics are taught to operators; no university teaches them.

export type PractitionerSection = {
  /** The article's own number for the section ("1"), or null when it numbers none. */
  label: string | null;
  heading: string;
  /** The sub-headings under it and, when asked for, the terms it sets in bold, in the order they appear. */
  topics: string[];
};

export type PractitionerText = {
  title: string;
  sections: PractitionerSection[];
  /** The article's text from its title to where it ends, one block per line. */
  text: string;
};

/** A section heading that ends the article: what follows is not about the subject. */
const END_MATTER = /^(acknowledg(e)?ments?|about the authors?|related (posts|reading)|further reading)$/i;
/** A section heading that is not a section of the subject. */
const NOT_A_SECTION = /^(intro|introduction)$/i;

const headingText = (fragment: string): string => plain(fragment).replace(/\s*:$/, '');

/** Bold runs longer than this are sentences set in bold, not terms. */
const MAX_TERM_WORDS = 6;

/**
 * The terms a stretch of a section sets in bold, as an article does where it
 * defines them: "ARR (annual recurring revenue)", "Gross churn". A run that
 * reads as a sentence (over six words, starting lower case, or with a comma
 * in it, such as an attribution "Ron Gill, NetSuite") is left out.
 */
function boldTerms(fragment: string): string[] {
  const terms: string[] = [];
  for (const match of fragment.matchAll(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const term = plain(match[2]).replace(/[\s:,.]+$/, '');
    if (term.length < 2 || term.length > 60 || !/^[A-Z0-9]/.test(term) || term.includes(',')) continue;
    if (term.split(' ').length > MAX_TERM_WORDS) continue;
    terms.push(term);
  }
  return terms;
}

/**
 * A practitioner's article from its page. The sections are the headings at
 * `level` (2 for an article whose sections are h2, 3 for one that groups them
 * under h2 parts), each with the headings one level below as its topics. A
 * section numbered "1. Bookings vs. revenue" keeps the number as its label.
 *
 * Only headings with no class attribute are the article's: the site's own
 * furniture (related posts, author cards, newsletter boxes) is drawn with
 * classed headings on both starting pages, so the first classed heading after
 * a section has opened ends the article, as does an acknowledgements heading.
 *
 * With `terms`, the terms each section sets in bold join its topics where
 * they appear: a16z's sections define their metrics that way, and a heading
 * such as "Recurring revenue vs. Total revenue" is found by a search for ARR
 * only through them. Skok's bold is emphasis and attributions, so his guide
 * is read without. Pure.
 */
export function parsePractitionerText(html: string, level: 2 | 3, options: { terms?: boolean } = {}): PractitionerText {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = h1 ? plain(h1) : pageTitle ? plain(pageTitle) : '';

  const start = html.search(/<h1\b/i);
  const body = (start >= 0 ? html.slice(start) : html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const sections: PractitionerSection[] = [];
  let open: PractitionerSection | null = null;
  let end = body.length;
  // Where the stretch of body since the last heading starts, for its bold terms.
  let since = 0;
  const harvest = (until: number) => {
    if (!open || !options.terms) return;
    for (const term of boldTerms(body.slice(since, until))) {
      if (term !== open.heading && !open.topics.includes(term)) open.topics.push(term);
    }
  };
  for (const match of body.matchAll(/<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)) {
    harvest(match.index);
    since = match.index + match[0].length;
    const depth = Number(match[1]);
    const classed = /\bclass\s*=/i.test(match[2]);
    if (classed) {
      if (sections.length > 0) {
        end = match.index;
        break;
      }
      continue;
    }
    const text = headingText(match[3]);
    if (!text) continue;
    if (depth === level) {
      if (END_MATTER.test(text)) {
        end = match.index;
        break;
      }
      if (NOT_A_SECTION.test(text)) {
        open = null;
        continue;
      }
      const numbered = /^(\d{1,3})\.\s*(.+)$/.exec(text);
      open = { label: numbered ? numbered[1] : null, heading: numbered ? numbered[2] : text, topics: [] };
      sections.push(open);
    } else if (depth === level + 1 && open) {
      open.topics.push(text);
    }
  }
  if (end === body.length) harvest(end);

  const text = decodeEntities(
    body
      .slice(0, end)
      .replace(/<\/(h[1-6]|p|li|div|tr|blockquote)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');

  return { title, sections, text };
}

/** One allowlisted practitioner article and who wrote it. */
export type PractitionerPage = {
  providerSlug: string;
  host: string;
  /** The article's path, with its trailing slash. */
  path: string;
  /** The heading level its sections are drawn at. */
  level: 2 | 3;
  /** Whether the terms it sets in bold are its topics too (parsePractitionerText). */
  terms: boolean;
  author: string;
  institution: string;
};

export const SKOK_SAAS_METRICS: PractitionerPage = {
  providerSlug: 'forentrepreneurs',
  host: 'www.forentrepreneurs.com',
  path: '/saas-metrics-2/',
  level: 2,
  terms: false,
  author: 'David Skok',
  institution: 'For Entrepreneurs',
};

export const A16Z_STARTUP_METRICS: PractitionerPage = {
  providerSlug: 'a16z',
  host: 'a16z.com',
  path: '/16-startup-metrics/',
  level: 3,
  terms: true,
  author: 'Jeff Jordan, Anu Hariharan, Frank Chen and Preethi Kasireddy',
  institution: 'Andreessen Horowitz',
};

const pageUrl = (page: PractitionerPage) => `https://${page.host}${page.path}`;

/** The article as the document the store keeps: one unit per section, in the article's order. */
export function practitionerDocument(article: PractitionerText, page: PractitionerPage): StructureDocumentInput {
  const url = pageUrl(page);
  return {
    providerSlug: page.providerSlug,
    externalId: page.path.replace(/^\/|\/$/g, ''),
    title: article.title,
    canonicalUrl: url,
    sourceUrl: url,
    author: page.author,
    institution: page.institution,
    licenceMode: 'structure_only',
    rawText: [article.title, url, article.text].join('\n\n'),
    units: article.sections.map((section) => ({
      label: section.label,
      heading: section.heading,
      topics: section.topics,
      readings: [],
    })),
  };
}

function practitionerSource(page: PractitionerPage): PracticalSource {
  const bare = page.path.replace(/\/$/, '');
  return {
    providerSlug: page.providerSlug,
    host: page.host,
    licenceMode: 'structure_only',
    pages: [pageUrl(page)],
    accepts: (url) => url.pathname === page.path || url.pathname === bare,
    pull: async () => {
      const fetched = await fetchDocument(pageUrl(page));
      if (!fetched.ok) return failure('fetch-failed', `${fetched.reason}: ${fetched.detail}`);
      const article = parsePractitionerText(fetched.text, page.level, { terms: page.terms });
      if (!article.title || article.sections.length === 0) {
        return failure('unparseable', 'No sections in the practitioner article.');
      }
      return { ok: true, document: practitionerDocument(article, page) };
    },
  };
}

// ---------------------------------------------------------------------------
// The allowlist

export const PRACTICAL_SOURCES: PracticalSource[] = [
  {
    providerSlug: 'uaex',
    host: UAEX_HOST,
    licenceMode: 'structure_only',
    pages: [UAEX_BEEKEEPING_URL],
    accepts: (url) => url.pathname === '/farm-ranch/special-programs/beekeeping/beekeepingshortcourse.aspx',
    pull: pullExtensionCourse,
  },
  {
    providerSlug: 'isa-arbor',
    host: ISA_HOST,
    licenceMode: 'structure_only',
    pages: [ISA_CERTIFIED_ARBORIST_URL],
    accepts: (url) => url.pathname === '/Portals/0/Assets/PDF/Certification-Applications/Cert-Exam-Outline-CA.pdf',
    pull: pullExamOutline,
  },
  practitionerSource(SKOK_SAAS_METRICS),
  practitionerSource(A16Z_STARTUP_METRICS),
];

/** The allowlisted source an address belongs to, or null. https only. */
export function practicalSourceFor(rawUrl: string): { source: PracticalSource; url: URL } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const source = PRACTICAL_SOURCES.find((candidate) => candidate.host === url.hostname && candidate.accepts(url));
  return source ? { source, url } : null;
}

/**
 * Pull the structure document at an allowlisted address, confirming it by
 * fetch: a page that does not parse is a failure, not an empty document. The
 * result is ready for `storeStructure`; nothing is written here.
 */
export async function pullPractical(rawUrl: string): Promise<PracticalResult> {
  const match = practicalSourceFor(rawUrl);
  if (!match) return failure('not-allowlisted', `${rawUrl} is not a page on the practical-skills allowlist.`);
  return match.source.pull(match.url);
}
