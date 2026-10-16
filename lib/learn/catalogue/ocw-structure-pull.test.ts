import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { describeGoal, pullOcwCourses, pullOcwForGoal, readProposedCourses, MAX_PROPOSED_COURSES } = await import(
  './ocw-structure-pull'
);
const { courseStructureFromPages } = await import('@/lib/learn/providers/ocw-structure');

/**
 * The `ocw` provider for a goal (plan #2247.3): a model proposes course
 * numbers, the sitemap confirms them, and only a fetched course is stored.
 * The sitemap and course pages are the live fixtures the parser tests use.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../providers/fixtures/structure/ocw/${name}`, import.meta.url), 'utf8');

const FINANCE = 'https://ocw.mit.edu/courses/15-431-entrepreneurial-finance-spring-2011/';

function financeStructure() {
  return courseStructureFromPages({
    courseUrl: FINANCE,
    course: fixture('15-431-course.html'),
    syllabus: fixture('15-431-syllabus.html'),
    calendar: fixture('15-431-calendar.html'),
    readings: fixture('15-431-readings.html'),
    lectureNotes: fixture('15-431-lecture-notes.html'),
  });
}

function ports() {
  const fetchCourse = vi.fn(async (url: string) => (url === FINANCE ? financeStructure() : null));
  const store = vi.fn(async () => ({ itemId: 'item-1', unchanged: false, material: 7 }));
  const readSitemap = vi.fn(async (): Promise<string | null> => fixture('sitemap.xml'));
  return { readSitemap, fetchCourse, store };
}

describe('readProposedCourses', () => {
  it('keeps numbers written like MIT course numbers, first mention only, up to the cap', () => {
    expect(
      readProposedCourses({
        courses: [
          { number: '15.431', title: 'Entrepreneurial Finance' },
          { number: '15.431', title: 'again' },
          { number: 'Finance 101', title: 'not MIT' },
          { number: '11.001j', title: 'Urban design' },
          { title: 'no number' },
        ],
      }),
    ).toEqual([
      { number: '15.431', title: 'Entrepreneurial Finance' },
      { number: '11.001J', title: 'Urban design' },
    ]);
    const many = { courses: Array.from({ length: 9 }, (_, i) => ({ number: `15.${400 + i}`, title: 't' })) };
    expect(readProposedCourses(many)).toHaveLength(MAX_PROPOSED_COURSES);
    expect(readProposedCourses(null)).toEqual([]);
  });

  it('asks about the goal by its name and line', () => {
    expect(describeGoal({ name: 'Venture capital', about: 'how deals are priced' })).toMatch(
      /^Goal: Venture capital\. how deals are priced\n/,
    );
  });
});

describe('pullOcwCourses', () => {
  it('stores a confirmed course, and says which numbers OCW does not have', async () => {
    const p = ports();
    const lines = await pullOcwCourses(['15.431', '15.999', 'nonsense'], p);
    expect(lines).toEqual([
      { number: '15.431', status: 'stored', itemId: 'item-1', courseUrl: FINANCE, units: 23, material: 7, unchanged: false },
      { number: '15.999', status: 'not-on-ocw' },
    ]);
    expect(p.readSitemap).toHaveBeenCalledTimes(1);
    expect(p.fetchCourse).toHaveBeenCalledTimes(1);
    const stored = (p.store.mock.calls as unknown as [NonNullable<ReturnType<typeof financeStructure>>][])[0][0];
    expect(stored.document.courseCode).toBe('15.431');
    expect(stored.material).toHaveLength(7);
  });

  it('never stores a course it could not read, and keeps going after one that fails', async () => {
    const p = ports();
    p.fetchCourse.mockImplementationOnce(async () => {
      throw new Error('socket hang up');
    });
    const lines = await pullOcwCourses(['15.431', '11.001J'], p);
    expect(lines).toEqual([
      { number: '15.431', status: 'failed', detail: 'socket hang up' },
      {
        number: '11.001J',
        status: 'no-structure',
        courseUrl: 'https://ocw.mit.edu/courses/11-001j-introduction-to-urban-design-and-development-spring-2006/',
      },
    ]);
    expect(p.store).not.toHaveBeenCalled();
  });

  it('marks every number unconfirmed when the sitemap cannot be read', async () => {
    const p = ports();
    p.readSitemap.mockResolvedValueOnce(null);
    expect(await pullOcwCourses(['15.431'], p)).toEqual([{ number: '15.431', status: 'not-on-ocw' }]);
    expect(p.fetchCourse).not.toHaveBeenCalled();
  });
});

describe('pullOcwForGoal', () => {
  function client(input: unknown) {
    const create = vi.fn(async () => ({
      content: [{ type: 'tool_use', name: 'report_mit_courses', id: 't', input }],
      usage: { input_tokens: 300, output_tokens: 60 },
      stop_reason: 'tool_use',
    }));
    return { client: { messages: { create } } as unknown as Anthropic, create };
  }

  it('proposes, confirms and stores, and records what the call cost', async () => {
    const { client: c, create } = client({ courses: [{ number: '15.431', title: 'Entrepreneurial Finance' }, { number: '15.999', title: 'Made up' }] });
    const spends: unknown[] = [];
    const p = ports();
    const result = await pullOcwForGoal({
      sql: null as never,
      goal: { name: 'Venture capital', about: null },
      anthropicApiKey: 'test',
      client: c,
      onSpend: (report) => spends.push(report),
      ports: p,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(spends).toHaveLength(1);
    expect(result).toMatchObject({
      ok: true,
      proposed: [{ number: '15.431' }, { number: '15.999' }],
      lines: [{ number: '15.431', status: 'stored' }, { number: '15.999', status: 'not-on-ocw' }],
    });
  });

  it('stores nothing when the model names nothing', async () => {
    const { client: c } = client({ courses: [] });
    const p = ports();
    const result = await pullOcwForGoal({ sql: null as never, goal: { name: 'Beekeeping', about: null }, anthropicApiKey: 'test', client: c, ports: p });
    expect(result).toEqual({ ok: true, proposed: [], lines: [] });
    expect(p.readSitemap).not.toHaveBeenCalled();
  });
});
