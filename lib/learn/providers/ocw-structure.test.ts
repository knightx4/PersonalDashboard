import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * Reading an MIT OpenCourseWare course's syllabus and calendar (plan #2247.3).
 *
 * The fixtures in fixtures/structure/ocw/ were fetched live from ocw.mit.edu
 * on 2026-10-16: for 15.431 Entrepreneurial Finance (Spring 2011) and 11.001J
 * Introduction to Urban Design and Development (Spring 2006), the course page
 * with its scripts and styles removed, and the main element of the syllabus,
 * calendar, readings and lecture-notes pages; and an excerpt of the sitemap
 * index. Each file opens with a comment naming its address.
 */

vi.mock('server-only', () => ({}));

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/structure/ocw/${name}`, import.meta.url), 'utf8');

const FINANCE = 'https://ocw.mit.edu/courses/15-431-entrepreneurial-finance-spring-2011/';
const URBAN = 'https://ocw.mit.edu/courses/11-001j-introduction-to-urban-design-and-development-spring-2006/';

const fetched = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./fetch', () => ({
  fetchDocument: async (url: string): Promise<FetchResult> => {
    fetched.calls.push(url);
    const files: Record<string, string> = {
      'https://ocw.mit.edu/sitemap.xml': 'sitemap.xml',
      [FINANCE]: '15-431-course.html',
      [`${FINANCE}pages/syllabus/`]: '15-431-syllabus.html',
      [`${FINANCE}pages/calendar/`]: '15-431-calendar.html',
      [`${FINANCE}pages/readings/`]: '15-431-readings.html',
      [`${FINANCE}pages/lecture-notes/`]: '15-431-lecture-notes.html',
    };
    const file = files[url];
    if (!file) return { ok: false, reason: 'not-found', detail: '404' };
    const text = fixture(file);
    return { ok: true, url, contentType: 'text', text, bytes: null, byteLength: text.length };
  },
}));

const ocw = await import('@/lib/learn/providers/ocw-structure');

function pagesFor(prefix: string, courseUrl: string) {
  return {
    courseUrl,
    course: fixture(`${prefix}-course.html`),
    syllabus: fixture(`${prefix}-syllabus.html`),
    calendar: fixture(`${prefix}-calendar.html`),
    readings: fixture(`${prefix}-readings.html`),
    lectureNotes: fixture(`${prefix}-lecture-notes.html`),
  };
}

beforeEach(() => {
  fetched.calls.length = 0;
});

describe('course numbers', () => {
  it('reads a number the way MIT writes it, and refuses anything else', () => {
    expect(ocw.normaliseCourseNumber('15.431')).toBe('15.431');
    expect(ocw.normaliseCourseNumber(' 11.001j ')).toBe('11.001J');
    expect(ocw.normaliseCourseNumber('Course 6.006')).toBe('6.006');
    expect(ocw.normaliseCourseNumber('18-06SC')).toBe('18.06SC');
    expect(ocw.normaliseCourseNumber('STS.001')).toBe('STS.001');
    expect(ocw.normaliseCourseNumber('Entrepreneurial finance')).toBeNull();
    expect(ocw.normaliseCourseNumber('15431')).toBeNull();
  });

  it('finds the offering in the sitemap by its number, newest first, and nothing it only starts like', () => {
    const sitemap = fixture('sitemap.xml');
    expect(ocw.offeringsFromSitemap(sitemap, '15.431')).toEqual([
      { courseUrl: FINANCE, slug: '15-431-entrepreneurial-finance-spring-2011', term: 'Spring 2011' },
    ]);
    // Without its J, a cross-listed subject is still found.
    expect(ocw.offeringsFromSitemap(sitemap, '11.001').map((o) => o.courseUrl)).toEqual([URBAN]);
    expect(ocw.offeringsFromSitemap(sitemap, '11.001J').map((o) => o.courseUrl)).toEqual([URBAN]);
    // 18.06 is not 18.065, 18.06SC or 18.06CI.
    expect(ocw.offeringsFromSitemap(sitemap, '18.06').map((o) => o.slug)).toEqual(['18-06-linear-algebra-spring-2010']);
    expect(ocw.offeringsFromSitemap(sitemap, '6.006').map((o) => o.term)).toEqual(['Spring 2020', 'Fall 2011', 'Spring 2008']);
    expect(ocw.offeringsFromSitemap(sitemap, '15.999')).toEqual([]);
  });
});

describe('the course page', () => {
  it('gives the title, number, term, instructor, description and the structure pages it links', () => {
    const info = ocw.courseInfoFromPage(fixture('15-431-course.html'), FINANCE)!;
    expect(info).toMatchObject({
      title: 'Entrepreneurial Finance',
      courseNumber: '15.431',
      term: 'Spring 2011',
      level: 'Graduate',
      instructors: ['Prof. Antoinette Schoar'],
    });
    expect(info.description).toMatch(/^15\.431 Entrepreneurial Finance examines the elements/);
    expect(info.pages).toEqual({
      syllabus: `${FINANCE}pages/syllabus/`,
      calendar: `${FINANCE}pages/calendar/`,
      readings: `${FINANCE}pages/readings/`,
      'lecture-notes': `${FINANCE}pages/lecture-notes/`,
    });
  });
});

describe('15.431: calendar, readings and lecture notes in separate columns', () => {
  const structure = ocw.courseStructureFromPages(pagesFor('15-431', FINANCE))!;
  const { document, material } = structure;

  it('keeps every session in order, with its part heading as a topic', () => {
    expect(document.units).toHaveLength(23);
    expect(document.units.map((u) => u.label)).toEqual(Array.from({ length: 23 }, (_, i) => `Session ${i + 1}`));
    expect(document.units[0]).toMatchObject({ heading: 'Introduction and overview of entrepreneurial finance', topics: [] });
    expect(document.units[2]).toMatchObject({
      heading: 'Discounted cash flow (DCF) and the venture capital method',
      topics: ['Business Valuation'],
    });
    // A session's second line (a guest) is a topic, not part of its heading.
    expect(document.units[12]).toMatchObject({
      heading: 'BNI Video',
      topics: [
        'Team Sheet Negotiation',
        'Guests: Conrad Clemson (Founder and CEO, BNI Video) and Carl Stjernfeldt (General Partner, Castile Ventures)',
      ],
    });
    expect(document.units[22].heading).toBe('Final review');
  });

  it("joins each session's readings from the readings page, one citation per paragraph", () => {
    expect(document.units[3].readings).toEqual([
      {
        title:
          'Mayfield, E. Scott. “NetFlix.com, Inc.” Harvard Business School Case. Harvard Business School Publishing. Case: 9-201-037, Rev. March 24, 2003.',
      },
    ]);
    expect(document.units[8].readings.map((r) => r.title.match(/Walnut Venture Associates \([AD]\)/)?.[0])).toEqual([
      'Walnut Venture Associates (A)',
      'Walnut Venture Associates (D)',
    ]);
    expect(document.units[4].readings).toEqual([
      {
        title: 'Lecture notes',
        detail: 'PDF',
        url: `${FINANCE}resources/mit15_431s11_lec05/`,
      },
    ]);
  });

  it('lists the lecture notes as material, each under its session, with a guest’s notes marked as theirs', () => {
    expect(material.map((m) => m.providerLabel)).toEqual([
      'Session 3',
      'Session 5',
      'Session 8',
      'Session 10',
      'Session 20',
      'Session 21',
      'Session 23',
    ]);
    expect(material[0]).toEqual({
      externalId: '15-431-entrepreneurial-finance-spring-2011/resources/mit15_431s11_lec01',
      title: '15.431 lecture notes, session 3: Discounted cash flow (DCF) and the venture capital method',
      canonicalUrl: `${FINANCE}resources/mit15_431s11_lec01/`,
      providerLabel: 'Session 3',
      licence: null,
    });
    expect(material[4].licence).toBe('Courtesy of Michael Szeto. Used with permission.');
  });

  it('reads the syllabus for its prerequisite and its two textbooks', () => {
    expect(document.prerequisites).toHaveLength(1);
    expect(document.prerequisites![0]).toMatch(/^The course requires the concepts and skills developed in 15\.402/);
    expect(document.textbooks).toEqual([
      'Levin, Jack S. Structuring Venture Capital, Private Equity, and Entrepreneurial Transactions. Aspen Publishers, 2009. ISBN: 9780735581609.',
      'Metrick, Andrew, and Ayako Yasuda. Venture Capital and the Finance of Innovation. Wiley, 2010. ISBN: 9780470454701.',
    ]);
    expect(document.outcomes).toEqual([]);
  });

  it('is a document the store accepts, shown under the course licence', () => {
    expect(document).toMatchObject({
      providerSlug: 'mit-ocw',
      externalId: '15-431-entrepreneurial-finance-spring-2011',
      title: 'Entrepreneurial Finance',
      canonicalUrl: FINANCE,
      sourceUrl: `${FINANCE}pages/calendar/`,
      author: 'Prof. Antoinette Schoar',
      institution: 'Massachusetts Institute of Technology',
      courseCode: '15.431',
      term: 'Spring 2011',
      licenceMode: 'show',
    });
    expect(() => structureRow(document)).not.toThrow();
    const rows = unitRows(document.units);
    expect(rows[2].text).toBe(
      [
        'Session 3: Discounted cash flow (DCF) and the venture capital method',
        'Topics: Business Valuation',
        'Readings: Kaplan, Steven N., and Antoinette Schoar. “Private Equity Performance: Returns, Persistence, and Capital Flows.” Journal of Finance 60, no. 4 (2005): 1791-1823.; Lecture notes (PDF)',
      ].join('\n'),
    );
  });

  it('keeps the four pages as raw text, headed by page, with no markup left', () => {
    expect(document.rawText.startsWith('15.431 | Entrepreneurial Finance | Spring 2011\n\n')).toBe(true);
    for (const heading of ['\nSyllabus\n', '\nCalendar\n', '\nReadings\n', '\nLecture Notes\n']) {
      expect(document.rawText).toContain(heading);
    }
    expect(document.rawText).toContain('3 | Discounted cash flow (DCF) and the venture capital method');
    expect(document.rawText).not.toMatch(/<[a-z/][^>]*>|&[a-z]+;/i);
    expect(document.rawText).not.toContain('Buy at');
  });
});

describe('11.001J: notes inside the topics cell, questions of the day under each session', () => {
  const { document, material } = ocw.courseStructureFromPages(pagesFor('11-001j', URBAN))!;

  it('takes the first line as the heading and the rest as topics, with the part above it', () => {
    expect(document.courseCode).toBe('11.001J');
    expect(document.units[0]).toMatchObject({
      label: 'Session 1',
      heading: 'Introduction',
      topics: [
        'Part 1: What is Urban Design and Development? - Translating Values into Design',
        'Questions of the day: What is urban design? What is urban development? How are they connected and how do they affect our lives?',
      ],
    });
    // "Three Urban Utopias:" and its three bullet lines.
    expect(document.units[8].heading).toBe('Three Urban Utopias');
    expect(document.units[8].topics.slice(1, 4)).toEqual([
      'Ebenezer Howard’s Garden City',
      'Le Corbusier’s Radiant City',
      'Frank Lloyd Wright’s Broadacre City',
    ]);
  });

  it('drops the shop link from a citation and keeps the book', () => {
    expect(document.units[2].readings.map((r) => r.title)).toContain(
      'Lynch, Kevin. The Image of the City. Cambridge, MA: MIT Press, 1960, pp. 1-25. ISBN: 9780262620017.',
    );
  });

  it('finds the notes linked inside the topics, and only the course’s own', () => {
    expect(document.units[1].readings.at(-1)).toEqual({
      title: 'Lecture notes',
      detail: 'PDF - 1.1 MB',
      url: `${URBAN}resources/2_ways_of_see/`,
    });
    expect(material).toHaveLength(14);
    expect(material.every((m) => m.canonicalUrl.startsWith(`${URBAN}resources/`))).toBe(true);
    // The image attribution PDF sits above the table, in no session.
    expect(material.some((m) => m.canonicalUrl.includes('imageatt'))).toBe(false);
  });

  it('every unit has a heading and the document passes the store’s checks', () => {
    expect(document.units.every((u) => u.heading.trim() !== '')).toBe(true);
    expect(() => unitRows(document.units)).not.toThrow();
    expect(() => structureRow(document)).not.toThrow();
  });
});

describe('6.006 (Spring 2020): a week per row, its lectures one per line', () => {
  it('heads each week with all its lectures, labelled by week', () => {
    const { units } = ocw.sessionsFromPages(
      { calendar: fixture('6-006-calendar.html') },
      'https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/',
    );
    expect(units).toHaveLength(14);
    expect(units[0]).toMatchObject({ label: 'Week 1', heading: 'Lecture 1: Introduction; Lecture 2: Data Structures' });
    expect(units[2]).toMatchObject({ label: 'Week 3', heading: 'Lecture 5: Linear Sorting' });
  });
});

describe('fallbacks', () => {
  it('takes the sessions from the readings page when a course has no calendar', () => {
    const pages = { ...pagesFor('15-431', FINANCE), calendar: null };
    const { document } = ocw.courseStructureFromPages(pages)!;
    expect(document.units).toHaveLength(23);
    expect(document.units[2].readings[0].title).toMatch(/^Kaplan, Steven N\./);
  });

  it('is null for a course with no session table, since there is no structure to keep', () => {
    expect(
      ocw.courseStructureFromPages({ courseUrl: FINANCE, course: fixture('15-431-course.html'), syllabus: fixture('15-431-syllabus.html') }),
    ).toBeNull();
  });

  it('a grading table on the syllabus is not a session table', () => {
    expect(ocw.sessionTable(fixture('15-431-syllabus.html'))).toBeNull();
  });
});

describe('fetching', () => {
  it('confirms numbers with one sitemap fetch and marks the one that is not there', async () => {
    const found = await ocw.findOcwCourses(['15.431', 'not a course', '15.999', '15.431'], ocw.ocwSitemapReader());
    expect(found).toEqual([
      { number: '15.431', offering: { courseUrl: FINANCE, slug: '15-431-entrepreneurial-finance-spring-2011', term: 'Spring 2011' } },
      { number: '15.999', offering: null },
    ]);
    expect(fetched.calls).toEqual(['https://ocw.mit.edu/sitemap.xml']);
  });

  it('reads a course in five fetches: its page, then the four pages it links', async () => {
    const structure = await ocw.fetchOcwCourseStructure(FINANCE);
    expect(structure?.document.units).toHaveLength(23);
    expect(structure?.material).toHaveLength(7);
    expect([...fetched.calls].sort()).toEqual(
      [
        FINANCE,
        `${FINANCE}pages/calendar/`,
        `${FINANCE}pages/lecture-notes/`,
        `${FINANCE}pages/readings/`,
        `${FINANCE}pages/syllabus/`,
      ].sort(),
    );
  });

  it('says when the site refused a page', async () => {
    const refused: string[] = [];
    const structure = await ocw.fetchOcwCourseStructure(URBAN, (detail) => refused.push(detail));
    expect(structure).toBeNull();
    expect(refused).toEqual([`${URBAN}: not-found, 404`]);
  });
});
