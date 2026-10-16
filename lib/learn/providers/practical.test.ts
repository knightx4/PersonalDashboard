import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/lib/learn/providers/fetch';
import { mayFeedText, mayShowText, structureRow, unitRows } from '@/lib/learn/catalogue/structure';

/**
 * Extension courses and certification syllabi.
 *
 * The fixtures in fixtures/structure/practical/ come from live fetches on
 * 2026-10-16: the content of the Arkansas Complete Beekeeping Short Course
 * page, and the text of the ISA Certified Arborist examination outline PDF as
 * extractPdfPages returns it (fifteen pages joined by a blank line).
 */

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/structure/practical/${name}`, import.meta.url), 'utf8');

const BEE = 'https://www.uaex.uada.edu/farm-ranch/special-programs/beekeeping/beekeepingshortcourse.aspx';
const HANDOUT_1 =
  'https://www.uaex.uada.edu/farm-ranch/special-programs/beekeeping/documents/UADA%20BeeCourse_Lesson_01.pdf';
const ISA = 'https://www.isa-arbor.com/Portals/0/Assets/PDF/Certification-Applications/Cert-Exam-Outline-CA.pdf';

const fetched = vi.hoisted(() => ({ calls: [] as string[], missing: new Set<string>() }));

vi.mock('./fetch', () => ({
  fetchDocument: async (url: string): Promise<FetchResult> => {
    fetched.calls.push(url);
    if (fetched.missing.has(url)) return { ok: false, reason: 'not-found', detail: '404' };
    if (url === BEE) {
      const text = readFileSync(
        new URL('./fixtures/structure/practical/uaex-beekeeping-short-course.html', import.meta.url),
        'utf8',
      );
      return { ok: true, url, contentType: 'html', text, bytes: null, byteLength: text.length };
    }
    if (url === ISA || url === HANDOUT_1) {
      const bytes = new TextEncoder().encode(url);
      return { ok: true, url, contentType: 'pdf', text: '', bytes, byteLength: bytes.length };
    }
    // The other handouts are over the 8 MB fetch limit.
    return { ok: false, reason: 'too-large', detail: 'over 8388608 bytes' };
  },
}));

vi.mock('./pdf-text', () => ({
  extractPdfPages: async (bytes: Uint8Array): Promise<string[] | null> => {
    const url = new TextDecoder().decode(bytes);
    if (url === ISA) {
      return [
        readFileSync(
          new URL('./fixtures/structure/practical/isa-certified-arborist-outline.txt', import.meta.url),
          'utf8',
        ),
      ];
    }
    return ['Complete Beekeeping Short Course\nPart 1', 'what is a honey bee?'];
  },
}));

const practical = await import('@/lib/learn/providers/practical');

beforeEach(() => {
  fetched.calls.length = 0;
  fetched.missing.clear();
});

describe('the allowlist', () => {
  it('accepts the two starting addresses and nothing else', () => {
    expect(practical.practicalSourceFor(BEE)?.source.providerSlug).toBe('uaex');
    expect(practical.practicalSourceFor(ISA)?.source.providerSlug).toBe('isa-arbor');
    expect(practical.practicalSourceFor(BEE.replace('https', 'http'))).toBeNull();
    expect(practical.practicalSourceFor('https://example.com/Cert-Exam-Outline-CA.pdf')).toBeNull();
    expect(practical.practicalSourceFor('https://www.uaex.uada.edu/farm-ranch/')).toBeNull();
  });

  it('refuses an address off the list without fetching', async () => {
    const result = await practical.pullPractical('https://example.com/');
    expect(result).toMatchObject({ ok: false, reason: 'not-allowlisted' });
    expect(fetched.calls).toEqual([]);
  });
});

describe('the Arkansas beekeeping short course page', () => {
  it('lists the lessons in the page order with a video and a handout each', () => {
    const course = practical.parseExtensionCourse(fixture('uaex-beekeeping-short-course.html'), BEE);
    expect(course.title).toBe('Complete Beekeeping Short Course Online');
    expect(course.lessons).toHaveLength(18);
    expect(course.lessons[0]).toMatchObject({
      label: null,
      number: 0,
      title: 'Is Beekeeping Right for You?',
      videoUrl: 'https://www.youtube.com/watch?v=X3Xp1lQpxOc',
      handoutUrl: null,
    });
    expect(course.lessons[1]).toMatchObject({ label: 'Part 1', title: 'Intro to Honey Bees & Beekeeping' });
    expect(course.lessons[17]).toMatchObject({ label: 'Part 17', title: 'Final Thoughts on Honey Bees' });
    expect(course.lessons.slice(1).map((lesson) => lesson.number)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(course.lessons.slice(1).every((lesson) => lesson.handoutUrl?.endsWith('.pdf'))).toBe(true);
    expect(course.lessons[4].handoutUrl).toBe(
      'https://www.uaex.uada.edu/farm-ranch/special-programs/beekeeping/documents/UADA%20BeeCourse_Lesson_04.pdf',
    );
    expect(course.allHandoutUrl).toMatch(/slideshow-all\.pdf$/);
    expect(course.overview).toContain('Complete Beekeeping Short Course');
  });

  it('takes outcomes from a list under an objectives heading, and none when the page has no such list', () => {
    expect(practical.parseExtensionCourse(fixture('uaex-beekeeping-short-course.html'), BEE).outcomes).toEqual([]);
    const html = `<h1>Course</h1><h2>Learning objectives</h2><ul><li>Light a smoker</li><li>Find the queen</li></ul>`;
    expect(practical.parseExtensionCourse(html, BEE).outcomes).toEqual(['Light a smoker', 'Find the queen']);
  });

  it('stores as ordered units under structure_only, reading the handouts it can', async () => {
    const result = await practical.pullPractical(BEE);
    if (!result.ok) throw new Error(result.detail);
    const doc = result.document;
    expect(doc.providerSlug).toBe('uaex');
    expect(doc.externalId).toBe('beekeepingshortcourse');
    expect(doc.licenceMode).toBe('structure_only');
    expect(mayShowText(doc.licenceMode) || mayFeedText(doc.licenceMode)).toBe(false);
    expect(doc.units).toHaveLength(18);
    expect(doc.units[2]).toMatchObject({ label: 'Part 2', heading: 'The Bee Hive' });
    expect(doc.units[2].readings.map((reading) => reading.title)).toEqual([
      'The Bee Hive (video)',
      'The Bee Hive (handout)',
    ]);
    expect(doc.rawText).toContain('Handout, Part 1:');
    expect(doc.rawText).toContain('what is a honey bee?');
    expect(doc.rawText).toContain('Handouts not read');
    expect(doc.rawText).toContain('Part 2');
    expect(fetched.calls).toContain(HANDOUT_1);
    expect(structureRow(doc).content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(unitRows(doc.units)).toHaveLength(18);
  });

  it('reports a page that will not load', async () => {
    fetched.missing.add(BEE);
    expect(await practical.pullPractical(BEE)).toMatchObject({ ok: false, reason: 'fetch-failed' });
  });
});

describe('the ISA Certified Arborist examination outline', () => {
  const outline = () => practical.parseExamOutline(fixture('isa-certified-arborist-outline.txt'));

  it('reads the ten domains in order with their weights', () => {
    const { domains } = outline();
    expect(domains.map((domain) => [domain.name, domain.weight])).toEqual([
      ['Tree Biology', 11],
      ['Tree Identification and Selection', 9],
      ['Soil Management', 7],
      ['Installation and Establishment', 9],
      ['Pruning', 14],
      ['Diagnosis and Treatment', 9],
      ['Trees and Construction', 9],
      ['Tree Risk', 11],
      ['Safe Work Practices', 15],
      ['Urban Forestry', 6],
    ]);
    expect(domains.reduce((sum, domain) => sum + domain.weight, 0)).toBe(100);
  });

  it('reads each task with its statement whole, wrapped lines joined', () => {
    const { domains } = outline();
    expect(domains[0].tasks.map((task) => task.letter)).toEqual(['A', 'B']);
    expect(domains[0].tasks[0].statement).toBe(
      'Specify and recommend tree work based on knowledge of tree anatomy, physiology, and biomechanics.',
    );
    const selection = domains[1].tasks.find((task) => task.letter === 'D');
    expect(selection?.statement).toBe(
      'Select tree(s) appropriate for a given planting site and project needs taking into consideration short- and long-term tree requirements and maintenance goals.',
    );
    expect(domains[9].tasks.map((task) => task.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(domains.every((domain) => domain.tasks.length > 0)).toBe(true);
  });

  it('keeps the knowledge list of a task and not its skills', () => {
    const task = outline().domains[0].tasks[0];
    expect(task.knowledge).toHaveLength(7);
    expect(task.knowledge[0]).toBe('Root anatomy and functions');
    expect(task.knowledge[2]).toBe(
      'Respiration, photosynthesis, and energy allocation and storage within the tree',
    );
    expect(task.knowledge).not.toContain('Identifying trees');
  });

  it('stores as ten units with the tasks as outcomes, under structure_only', async () => {
    const result = await practical.pullPractical(ISA);
    if (!result.ok) throw new Error(result.detail);
    const doc = result.document;
    expect(doc.providerSlug).toBe('isa-arbor');
    expect(doc.externalId).toBe('cert-exam-outline-ca');
    expect(doc.licenceMode).toBe('structure_only');
    expect(mayShowText(doc.licenceMode) || mayFeedText(doc.licenceMode)).toBe(false);
    expect(doc.units).toHaveLength(10);
    expect(doc.units[0]).toMatchObject({ label: '11% of the exam', heading: 'Tree Biology' });
    expect(doc.units[0].topics[0]).toMatch(/^Specify and recommend tree work/);
    expect(doc.outcomes?.[0]).toMatch(/^Tree Biology, task A: Specify and recommend/);
    expect(doc.outcomes!.length).toBe(outline().domains.reduce((sum, domain) => sum + domain.tasks.length, 0));
    expect(doc.rawText).toContain('Safe Work Practices');
    expect(structureRow(doc).outcomes).toHaveLength(doc.outcomes!.length);
    expect(unitRows(doc.units)).toHaveLength(10);
  });

  it('reports a file with no outline in it', async () => {
    expect(practical.parseExamOutline('A scanned page with nothing to read.').domains).toEqual([]);
  });
});
