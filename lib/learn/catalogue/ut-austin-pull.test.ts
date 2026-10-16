import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { StructureDocumentInput } from '@/lib/learn/catalogue/structure';

vi.mock('server-only', () => ({}));

const {
  MAX_SYLLABI_PER_SEARCH,
  pullUtForGoal,
  pullUtSearch,
  readProposedSearches,
  screenState,
  syllabusScreen,
} = await import('./ut-austin-pull');
const { parseDepartments, recentTerms } = await import('@/lib/learn/providers/ut-austin');

/**
 * The `ut_austin` provider (plan #2247.4): a model proposes searches, the
 * results pages confirm what exists, a screen checks each downloaded syllabus,
 * and only what passed is stored. The pages and syllabus texts are the live
 * fixtures the parser tests use.
 */

const fixture = (name: string) =>
  readFileSync(new URL(`../providers/fixtures/structure/ut-austin/${name}`, import.meta.url), 'utf8');

const DEPARTMENTS = parseDepartments(fixture('form.html'));
const TERMS = recentTerms(new Date('2026-10-16T12:00:00Z'));
const download = (id: string) => `https://utdirect.utexas.edu/apps/student/coursedocs/courses/nlogon/download/${id}/`;

/** The first three download rows of the fixture, in table order. */
const FIRST = download('17374053'); // HIS 363T, Latin America in the Sixties
const SECOND = download('17387548'); // HIS 357C, African American History to 1860
const THIRD = download('17379949'); // HIS 356K, Main Currents of American Culture since 1865

function ports(options: { resultsOnTerm?: number; screen?: (d: StructureDocumentInput) => Promise<boolean> } = {}) {
  const resultsOnTerm = options.resultsOnTerm ?? 0;
  const search = vi.fn(async (query: { year: number; semester: number }) => {
    const index = TERMS.findIndex((term) => term.year === query.year && term.semester === query.semester);
    return index === resultsOnTerm ? fixture('results-his-2026-fall-america.html') : fixture('form.html');
  });
  const texts: Record<string, string> = {
    [FIRST]: fixture('his-317l-fall-2026.txt'),
    // A syllabus cut off before its schedule.
    [SECOND]: fixture('his-353-spring-2025.txt').split('PART I:')[0],
  };
  const fetchSyllabus = vi.fn(async (url: string) => texts[url] ?? null);
  const store = vi.fn<(document: StructureDocumentInput) => Promise<{ itemId: string; unchanged: boolean }>>(
    async () => ({ itemId: 'item-1', unchanged: false }),
  );
  const screen = vi.fn(options.screen ?? (async () => true));
  return { search, fetchSyllabus, store, screen };
}

describe('readProposedSearches', () => {
  it('keeps searches in departments the form offers, a few words each, up to the cap', () => {
    expect(
      readProposedSearches(
        {
          searches: [
            { department: 'his', title: 'American Revolution' },
            { department: 'HIS', title: 'american revolution' },
            { department: 'XYZ', title: 'not a department' },
            { department: 'ECO', title: 'a whole sentence about what the person wants to learn' },
            { department: 'b a', title: 'finance' },
            { department: 'ECO', title: 'microeconomic' },
            { department: 'GOV', title: 'constitution' },
          ],
        },
        DEPARTMENTS,
      ),
    ).toEqual([
      { department: 'HIS', title: 'american revolution' },
      { department: 'B A', title: 'finance' },
      { department: 'ECO', title: 'microeconomic' },
    ]);
    expect(readProposedSearches(null, DEPARTMENTS)).toEqual([]);
  });
});

describe('pullUtSearch', () => {
  it('stores a syllabus with a schedule, records Simple Syllabus rows, and skips one with no schedule', async () => {
    const p = ports();
    const pulled = await pullUtSearch({ department: 'HIS', title: 'america', terms: TERMS }, p);

    // Three syllabi were found on the first term, so no other term was read.
    expect(p.search).toHaveBeenCalledTimes(1);
    expect(p.fetchSyllabus.mock.calls.map(([url]) => url)).toEqual([FIRST, SECOND, THIRD]);
    expect(MAX_SYLLABI_PER_SEARCH).toBe(3);

    const byStatus = (status: string) => pulled.lines.filter((line) => line.status === status);
    expect(byStatus('not-fetchable')).toHaveLength(4);
    expect(byStatus('not-fetchable')[0]).toEqual({
      status: 'not-fetchable',
      url: 'https://utexas.simplesyllabus.com/doc/o23gr5e2v',
      courseCode: 'HIS 346W',
      term: '2026 Fall',
      title: 'Church and State in Latin America',
    });
    expect(byStatus('stored')).toEqual([
      {
        status: 'stored',
        itemId: 'item-1',
        url: FIRST,
        courseCode: 'HIS 363T',
        term: '2026 Fall',
        units: 16,
        textbooks: expect.arrayContaining([expect.stringMatching(/^Taylor, Alan/)]),
        unchanged: false,
      },
    ]);
    expect(byStatus('no-schedule')).toEqual([{ status: 'no-schedule', url: SECOND, courseCode: 'HIS 357C', term: '2026 Fall' }]);
    expect(byStatus('failed')).toHaveLength(1);

    // Only the document with a schedule reached the screen and the store.
    expect(p.screen).toHaveBeenCalledTimes(1);
    expect(p.store).toHaveBeenCalledTimes(1);
    const stored = p.store.mock.calls[0][0];
    expect(stored.licenceMode).toBe('structure_only');
    expect(stored.units[0].label).toBe('Week 1');
  });

  it('reads back through the terms until it finds results, and stores nothing the screen refuses', async () => {
    const p = ports({ resultsOnTerm: 3, screen: async () => false });
    const pulled = await pullUtSearch({ department: 'HIS', title: 'america', terms: TERMS }, p);
    expect(p.search).toHaveBeenCalledTimes(4);
    expect(pulled.termsRead).toBe(1);
    expect(pulled.lines.filter((line) => line.status === 'screened-out')).toHaveLength(1);
    expect(p.store).not.toHaveBeenCalled();
  });

  it('stores without a screen when none is given', async () => {
    const p = ports();
    await pullUtSearch({ department: 'HIS', title: 'america', terms: TERMS }, { ...p, screen: null });
    expect(p.store).toHaveBeenCalledTimes(1);
  });
});

function client(input: unknown, name: string) {
  const create = vi.fn(async () => ({
    content: [{ type: 'tool_use', name, id: 't', input }],
    usage: { input_tokens: 300, output_tokens: 20 },
    stop_reason: 'tool_use',
  }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe('the screen', () => {
  const text = fixture('his-317l-fall-2026.txt');
  const document: StructureDocumentInput = {
    providerSlug: 'ut-austin',
    externalId: '17372599',
    title: 'The Era of the American Revolution (HIS 317L, 2026 Fall)',
    canonicalUrl: download('17372599'),
    sourceUrl: download('17372599'),
    courseCode: 'HIS 317L',
    licenceMode: 'structure_only',
    rawText: text,
    units: [{ label: 'Week 1', heading: 'Introduction & Welcome', topics: ['Why Study the American Revolution Today?'], readings: [] }],
  };

  it('reads the structure and never a sentence of the syllabus', () => {
    const state = JSON.stringify(screenState(document));
    expect(state).toContain('Week 1: Introduction & Welcome');
    expect(state).not.toContain('Generative AI use is strictly prohibited');
    expect(state.length).toBeLessThan(1000);
  });

  it('asks Haiku and sends nothing to Jev when the account has not opted in', async () => {
    const jevFetch = vi.fn() as unknown as typeof fetch;
    const { client: c, create } = client({ syllabus_with_schedule: true }, 'report_syllabus_check');
    const spend: unknown[] = [];
    const screen = syllabusScreen({ jevEnabled: false, anthropicApiKey: 'test', client: c, jevApiKey: 'k', jevFetch, onSpend: (r) => spend.push(r) });
    expect(await screen(document)).toBe(true);
    expect(jevFetch).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(spend).toHaveLength(1);
  });

  it("takes Jev's answer at 0.8 or more, and asks Haiku below it", async () => {
    const jevSays = (noul: number) =>
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ model: 'jev-1.13.0', answers: { answer: { noul } }, usage: { input_tokens: 400, output_tokens: 5 } }),
          ),
      ) as unknown as typeof fetch;

    const sure = client({ syllabus_with_schedule: true }, 'report_syllabus_check');
    const no = syllabusScreen({ jevEnabled: true, anthropicApiKey: 'test', client: sure.client, jevApiKey: 'k', jevFetch: jevSays(0.05) });
    expect(await no(document)).toBe(false);
    expect(sure.create).not.toHaveBeenCalled();

    const unsure = client({ syllabus_with_schedule: true }, 'report_syllabus_check');
    const maybe = syllabusScreen({ jevEnabled: true, anthropicApiKey: 'test', client: unsure.client, jevApiKey: 'k', jevFetch: jevSays(0.6) });
    expect(await maybe(document)).toBe(true);
    expect(unsure.create).toHaveBeenCalledTimes(1);
  });
});

describe('pullUtForGoal', () => {
  it('proposes from the form departments, then searches each proposal', async () => {
    const { client: c, create } = client(
      { searches: [{ department: 'HIS', title: 'america' }, { department: 'NOPE', title: 'made up' }] },
      'report_ut_searches',
    );
    const p = ports();
    const result = await pullUtForGoal({
      sql: null as never,
      goal: { name: 'Understand the American Revolution', about: null },
      anthropicApiKey: 'test',
      jevEnabled: false,
      now: new Date('2026-10-16T12:00:00Z'),
      client: c,
      departments: DEPARTMENTS,
      ports: p,
    });
    expect(create).toHaveBeenCalledTimes(1);
    const system = (create.mock.calls[0] as unknown as [{ system: string }])[0].system;
    expect(system).toContain('HIS: History');
    expect(result.ok && result.proposed).toEqual([{ department: 'HIS', title: 'america' }]);
    expect(result.ok && result.searches[0].lines.some((line) => line.status === 'stored')).toBe(true);
  });

  it('stops when the form cannot be read', async () => {
    const result = await pullUtForGoal({
      sql: null as never,
      goal: { name: 'x', about: null },
      anthropicApiKey: 'test',
      jevEnabled: false,
      departments: [],
      ports: ports(),
    });
    expect(result).toEqual({ ok: false, detail: 'The UT Austin syllabus form could not be read.' });
  });
});
