import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { mayFeedText, mayShowText, structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * UT Austin's public syllabi (plan #2247.4).
 *
 * The fixtures in fixtures/structure/ut-austin/ come from live fetches of
 * utdirect.utexas.edu on 2026-10-16: the search form, the History results for
 * Fall 2026 matching "america", and the text extractPdfPages returns (pages
 * joined by a blank line) for four syllabus PDFs downloaded from it, one per
 * shape of schedule the parser reads: Week heads with dated classes and
 * "Readings:" blocks (HIS 317L), Week heads with dated classes naming readings
 * in brackets (HIS 352F), dated lines alone (ECO 420K), and classes numbered
 * under parts with no dates (HIS 353).
 */

vi.mock('./fetch', () => ({
  fetchDocument: async (url: string): Promise<FetchResult> => {
    if (url.endsWith('/download/1/')) {
      const bytes = new TextEncoder().encode('pdf');
      return { ok: true, url, contentType: 'pdf', text: '', bytes, byteLength: 3 };
    }
    if (url.endsWith('/download/2/')) return { ok: true, url, contentType: 'html', text: '<p>', bytes: null, byteLength: 3 };
    return { ok: false, reason: 'not-found', detail: '404' };
  },
}));
vi.mock('./pdf-text', () => ({ extractPdfPages: async () => ['Page one', 'Page two'] }));

const {
  fetchUtSyllabusText,
  parseDepartments,
  parseSyllabus,
  parseUtResults,
  recentTerms,
  termYear,
  utDownloadUrl,
  utSearchUrl,
  utSyllabusDocument,
} = await import('./ut-austin');

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/structure/ut-austin/${name}`, import.meta.url), 'utf8');

describe('recentTerms', () => {
  it('runs back from the current term, newest first, summers included', () => {
    expect(recentTerms(new Date('2026-10-16T12:00:00Z')).map((term) => term.label)).toEqual([
      '2026 Fall', '2026 Summer', '2026 Spring', '2025 Fall', '2025 Summer', '2025 Spring', '2024 Fall', '2024 Summer',
    ]);
    expect(recentTerms(new Date('2026-03-01T00:00:00Z'), 2).map((term) => [term.year, term.semester])).toEqual([
      [2026, 2],
      [2025, 9],
    ]);
  });
});

describe('the form', () => {
  it('reads the department codes, spaces and all', () => {
    const departments = parseDepartments(fixture('form.html'));
    expect(departments.length).toBeGreaterThan(250);
    expect(departments).toContainEqual({ code: 'HIS', name: 'History' });
    expect(departments).toContainEqual({ code: 'ECO', name: 'Economics' });
    expect(departments).toContainEqual({ code: 'B A', name: 'Business Administration' });
    expect(departments.some((department) => department.code === '')).toBe(false);
  });

  it('builds the GET the form sends', () => {
    expect(utSearchUrl({ year: 2026, semester: 9, department: 'HIS', courseTitle: ' america ' })).toBe(
      'https://utdirect.utexas.edu/apps/student/coursedocs/nlogon/?year=2026&semester=9&department=HIS&course_number=&course_title=america&unique=&csn=&instructor_first=&instructor_last=&course_type=In+Residence',
    );
  });
});

describe('parseUtResults', () => {
  it('reads each section with its syllabus link, never a CV link', () => {
    const results = parseUtResults(fixture('results-his-2026-fall-america.html'));
    expect(results.searched).toBe(true);
    expect(results.rows).toHaveLength(18);
    const era = results.rows.find((row) => row.title === 'The Era of the American Revolution');
    expect(era).toEqual({
      term: '2026 Fall',
      courseCode: 'HIS 317L',
      unique: '40975',
      title: 'The Era of the American Revolution',
      instructors: ['Amanda Faulkner'],
      syllabus: {
        kind: 'download',
        id: '17372599',
        url: 'https://utdirect.utexas.edu/apps/student/coursedocs/courses/nlogon/download/17372599/',
      },
    });
  });

  it('marks the Simple Syllabus rows as their own kind', () => {
    const rows = parseUtResults(fixture('results-his-2026-fall-america.html')).rows;
    const simple = rows.filter((row) => row.syllabus?.kind === 'simple-syllabus');
    expect(simple.map((row) => row.courseCode)).toEqual(['HIS 346W', 'HIS 355N', 'HIS 314K', 'HIS 346L']);
    expect(simple[0].syllabus).toEqual({ kind: 'simple-syllabus', url: 'https://utexas.simplesyllabus.com/doc/o23gr5e2v' });
  });

  it('reads the echoed form as no search', () => {
    expect(parseUtResults(fixture('form.html'))).toEqual({ searched: false, rows: [] });
  });
});

describe('parseSyllabus', () => {
  it('reads Week heads with dated classes and Readings blocks (HIS 317L)', () => {
    const parsed = parseSyllabus(fixture('his-317l-fall-2026.txt'), 2026);
    expect(parsed.units).toHaveLength(16);
    expect(parsed.units.map((unit) => unit.label)).toEqual(Array.from({ length: 16 }, (_, i) => `Week ${i + 1}`));
    const [first, second] = parsed.units;
    expect(first.topics).toEqual([
      'Introduction & Welcome',
      'Why Study the American Revolution Today?',
      'Tyranny and Tumult, 1689-1754',
    ]);
    expect(first.readings[0]).toEqual({ title: 'Alan Taylor, American Revolutions, “Introduction”', detail: 'pp. 1-9' });
    // A title wrapped onto the next line is joined.
    expect(second.topics).toContain('“Some Crisis Now Forming”: British America on the Eve of Revolution');
    expect(parsed.units[2].topics).toContain('The Goods, the Bad and the Ugly: Consumer Goods and the British Atlantic');
    // Canvas instructions are not readings.
    const titles = parsed.units.flatMap((unit) => unit.readings.map((reading) => reading.title));
    expect(titles.some((title) => /posted on Canvas|^It is/i.test(title))).toBe(false);
    expect(parsed.units[13].heading).toBe('Thanksgiving Break. Pursue Happiness');
    expect(parsed.textbooks).toHaveLength(2);
    expect(parsed.textbooks[0]).toMatch(/^Taylor, Alan\. American Revolutions: A Continental History/);
    expect(parsed.textbooks[1]).toMatch(/^Fenn, Elizabeth\. Pox Americana/);
    expect(parsed.outcomes).toHaveLength(4);
    expect(parsed.outcomes[1]).toBe('Learning to read and analyze primary sources');
  });

  it('reads Week heads with readings named in brackets (HIS 352F)', () => {
    const parsed = parseSyllabus(fixture('his-352f-fall-2025.txt'), 2025);
    expect(parsed.units).toHaveLength(16);
    expect(parsed.units[2]).toEqual({
      label: 'Week 3',
      heading: 'The Porfiriato, 1876-1911',
      topics: ['Porfirian Mexico', 'Mounting Crises'],
      readings: [
        { title: 'Joseph & Buchenau, ch. 2' },
        { title: 'Gerber and Passananti' },
        { title: 'source doc, Creelman' },
      ],
    });
    // A bracket that runs onto the next line, and one with brackets inside it.
    expect(parsed.units[4].readings.map((reading) => reading.title)).toContain('source docs, Zapata and/or Lewis');
    expect(parsed.units[9].topics[0]).toBe('Educating campesinos');
    // A link in brackets is dropped from the topic.
    expect(parsed.units[4].topics).toContain('Film: El compadre Mendoza');
    expect(parsed.units[13].topics).toEqual(['No classes, Thanksgiving Holiday/Fall Break']);
    expect(parsed.textbooks).toHaveLength(5);
    expect(parsed.textbooks.at(-1)).toBe('John Womack Jr., Zapata and the Mexican Revolution (New York: Vintage, 1969)');
    expect(parsed.prerequisites).toEqual(['Upper Division Standing']);
  });

  it('groups dated lines alone into weeks and names the textbook chapter (ECO 420K)', () => {
    const parsed = parseSyllabus(fixture('eco-420k-fall-2026.txt'), 2026);
    expect(parsed.textbooks).toEqual([
      'Microeconomics Theory and Applications with Calculus. By Jeffrey M. Perloff. Fifth Edition. Pearson Publishing',
    ]);
    expect(parsed.units.length).toBeGreaterThanOrEqual(14);
    expect(parsed.units[0]).toEqual({
      label: 'Week 1',
      heading: 'Intro, Syllabus overview, Supply and Demand',
      topics: ['Intro, Syllabus overview, Supply and Demand', 'Supply and Demand'],
      readings: [
        { title: 'Microeconomics Theory and Applications with Calculus', detail: 'Chap One' },
        { title: 'Microeconomics Theory and Applications with Calculus', detail: 'Chap Two' },
      ],
    });
    // Homework deadlines are not topics.
    expect(parsed.units.flatMap((unit) => unit.topics).some((topic) => /homework/i.test(topic))).toBe(false);
    expect(parsed.units.at(-1)?.heading).toBe('Review');
    expect(parsed.prerequisites[0]).toMatch(/^Economics 304K and 304L/);
  });

  it('reads classes numbered under parts with no dates (HIS 353)', () => {
    const parsed = parseSyllabus(fixture('his-353-spring-2025.txt'), 2025);
    expect(parsed.units).toHaveLength(14);
    expect(parsed.units[0]).toEqual({ label: '1', heading: 'The AR and A Society of Orders', topics: [], readings: [] });
    expect(parsed.units[9].heading).toBe('1793-4 The Terror and counter-revolution');
    expect(parsed.units[13].heading).toBe('The legacy');
    expect(parsed.textbooks).toEqual([
      'Jeremy Popkin, A New World Begins (2020 edition)',
      'David A. Bell, Napoleon: A Concise Biography (2019)',
      'Rafe Blaufarb and Claudia Liebeskind, Napoleonic Foot Soldiers and Civilians: A Brief History with Documents',
    ]);
    expect(parsed.outcomes[0]).toBe('how to read a complex book and assess its arguments');
  });

  it('finds no schedule where there is none, and takes no short numbered list for one', () => {
    const text = fixture('his-353-spring-2025.txt');
    const before = text.slice(0, text.indexOf('PART I:'));
    expect(parseSyllabus(before, 2025).units).toEqual([]);
    // HIS 352F numbers its reading lists 1 to 4; that is not a schedule.
    const mexico = fixture('his-352f-fall-2025.txt');
    expect(parseSyllabus(mexico.slice(0, mexico.indexOf('Course Schedule')), 2025).units).toEqual([]);
  });
});

describe('utSyllabusDocument', () => {
  it('stores the syllabus structure only, under its download id', () => {
    const row = parseUtResults(fixture('results-his-2026-fall-america.html')).rows.find(
      (candidate) => candidate.courseCode === 'HIS 317L' && candidate.title.startsWith('The Era'),
    )!;
    const link = row.syllabus as { kind: 'download'; id: string; url: string };
    const text = fixture('his-317l-fall-2026.txt');
    const document = utSyllabusDocument(row, link, text, parseSyllabus(text, termYear(row.term)!));
    expect(document).toMatchObject({
      providerSlug: 'ut-austin',
      externalId: '17372599',
      title: 'The Era of the American Revolution (HIS 317L, 2026 Fall)',
      canonicalUrl: utDownloadUrl('17372599'),
      author: 'Amanda Faulkner',
      courseCode: 'HIS 317L',
      term: '2026 Fall',
      licenceMode: 'structure_only',
    });
    expect(mayShowText(document.licenceMode)).toBe(false);
    expect(mayFeedText(document.licenceMode)).toBe(false);
    expect(structureRow(document).textbooks).toHaveLength(2);
    expect(unitRows(document.units)).toHaveLength(16);
  });
});

describe('fetchUtSyllabusText', () => {
  it('joins the pages of a PDF, and refuses anything else', async () => {
    const refused: string[] = [];
    expect(await fetchUtSyllabusText('https://utdirect.utexas.edu/x/download/1/')).toBe('Page one\n\nPage two');
    expect(await fetchUtSyllabusText('https://utdirect.utexas.edu/x/download/2/', (d) => refused.push(d))).toBeNull();
    expect(await fetchUtSyllabusText('https://utdirect.utexas.edu/x/download/3/', (d) => refused.push(d))).toBeNull();
    expect(refused).toEqual([
      'https://utdirect.utexas.edu/x/download/2/: not a PDF',
      'https://utdirect.utexas.edu/x/download/3/: not-found',
    ]);
  });
});
