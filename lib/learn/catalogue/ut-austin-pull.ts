import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type postgres from 'postgres';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { StructureDocumentInput } from '@/lib/learn/catalogue/structure';
import { storeStructure } from '@/lib/learn/catalogue/structure-store';
import type { GoalToClassify } from '@/lib/learn/goal-kind';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { decideWithJev } from '@/lib/jev/decide';
import {
  fetchUtForm,
  fetchUtResults,
  fetchUtSyllabusText,
  MIN_UNITS,
  parseDepartments,
  parseSyllabus,
  parseUtResults,
  recentTerms,
  termYear,
  utSyllabusDocument,
  type UtDepartment,
  type UtRefused,
  type UtResultRow,
  type UtSearch,
  type UtTerm,
} from '@/lib/learn/providers/ut-austin';

/**
 * Pulling UT Austin syllabi into the structure store (plan #2247.4), the
 * `ut_austin` provider in lib/learn/goal-kind.ts.
 *
 * As with OCW (./ocw-structure-pull.ts), a model proposes, a fetch confirms,
 * and only what was fetched is stored:
 *
 *   1. The form page, one fetch, gives the department codes.
 *   2. One Haiku call names up to three searches for the goal, each a
 *      department code from that list and a few words of a course title.
 *   3. Each search runs against the last eight terms, newest first, until it
 *      has three syllabi to download. A section whose syllabus is on Simple
 *      Syllabus is recorded as not fetchable and never fetched.
 *   4. Each syllabus PDF is downloaded, its text extracted and parsed. One
 *      with fewer than three units has no schedule and is not stored. One
 *      with a schedule is screened: Jev answers whether it is a syllabus that
 *      lays the course out in order, its answer standing at 0.8 or more, with
 *      Haiku asked below that, or always when the account has not opted in
 *      to Jev. Only a document that passes is stored.
 *
 * The screen reads the document's structure and never its prose: the course,
 * the unit labels, headings and topics, which a `structure_only` document
 * allows a model to read. A sentence of the syllabus never leaves the app.
 *
 * `pullUtSearch` is steps 3 and 4 for a department and title somebody names.
 */

export const UT_PROPOSE_MODEL = MODELS.learnStructurePropose;
export const UT_SCREEN_MODEL = MODELS.learnStructurePropose;

/** Searches one goal proposes. */
export const MAX_PROPOSED_SEARCHES = 3;
/** Syllabi one search downloads, across all the terms it reads. */
export const MAX_SYLLABI_PER_SEARCH = 3;
/** Terms one search reads, newest first. */
export const TERMS_SEARCHED = 8;

// ---------------------------------------------------------------------------
// Proposing searches

const PROPOSE_TOOL = 'report_ut_searches';

function proposeSystem(departments: UtDepartment[]): string {
  return `You choose searches of the University of Texas at Austin's public syllabus
archive whose results would give the structure for one person's learning goal.
A search is a department code and a few words matched against course section
titles, such as HIS with "american revolution" or ECO with "microeconomic".

Name up to ${MAX_PROPOSED_SEARCHES} searches, best first. The department must be one of the codes
below, exactly as written. The title words are matched as a substring of the
section title, so use one to three plain words a title would contain, not a
sentence. Name none if no UT Austin department teaches this.

Report them through ${PROPOSE_TOOL}.

Departments:
${departments.map((department) => `${department.code}: ${department.name}`).join('\n')}`;
}

export type ProposedSearch = { department: string; title: string };

/**
 * Read the tool payload: each entry whose department is one the form offers
 * and whose title is a few words, first mention kept, at most
 * MAX_PROPOSED_SEARCHES. Pure, exported for the test.
 */
export function readProposedSearches(input: unknown, departments: UtDepartment[]): ProposedSearch[] {
  const list = (input as { searches?: unknown } | null)?.searches;
  if (!Array.isArray(list)) return [];
  const codes = new Map(departments.map((department) => [department.code.toUpperCase(), department.code]));
  const out: ProposedSearch[] = [];
  for (const entry of list) {
    const e = entry as { department?: unknown; title?: unknown } | null;
    const department = typeof e?.department === 'string' ? codes.get(e.department.trim().toUpperCase()) : undefined;
    const title = typeof e?.title === 'string' ? e.title.replace(/\s+/g, ' ').trim().toLowerCase() : '';
    if (!department || title.length < 3 || title.length > 40 || title.split(' ').length > 4) continue;
    if (out.some((search) => search.department === department && search.title === title)) continue;
    out.push({ department, title });
    if (out.length === MAX_PROPOSED_SEARCHES) break;
  }
  return out;
}

export function describeGoal(goal: GoalToClassify): string {
  const about = goal.about?.trim();
  return `Goal: ${goal.name.trim()}${about ? `. ${about}` : ''}\n\nCall ${PROPOSE_TOOL} with the searches.`;
}

export type ProposeResult = { ok: true; searches: ProposedSearch[] } | { ok: false; detail: string };

export async function proposeUtSearches(input: {
  goal: GoalToClassify;
  departments: UtDepartment[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ProposeResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: UT_PROPOSE_MODEL,
      max_tokens: 1024,
      system: proposeSystem(input.departments),
      tools: [
        {
          name: PROPOSE_TOOL,
          description: 'Report the syllabus archive searches for this goal, best first.',
          input_schema: {
            type: 'object',
            properties: {
              searches: {
                type: 'array',
                maxItems: MAX_PROPOSED_SEARCHES,
                items: {
                  type: 'object',
                  properties: { department: { type: 'string' }, title: { type: 'string' } },
                  required: ['department', 'title'],
                },
              },
            },
            required: ['searches'],
          },
        },
      ],
      tool_choice: forceTool(PROPOSE_TOOL, UT_PROPOSE_MODEL),
      messages: [{ role: 'user', content: describeGoal(input.goal) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The proposing call failed.' };
  }
  input.onSpend?.({ model: UT_PROPOSE_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === PROPOSE_TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, searches: readProposedSearches(block.input, input.departments) };
}

// ---------------------------------------------------------------------------
// Screening a downloaded document

export const SCREEN_QUESTION = {
  type: 'yes-no',
  question:
    'This is the outline of a document downloaded from a university syllabus archive: the course, ' +
    'and the units its parser found with their topics. Is it a course syllabus whose schedule lays ' +
    'out what the course covers in order, week by week or session by session?',
  yes: 'A syllabus with a schedule of what is taught, in order.',
  no: 'Something else: a CV, a reading list, a policy page, or a list of dates that are not topics.',
} as const;

/**
 * What the screen reads: the structure of the document, never its text. A
 * `structure_only` document's headings and topics may go to a model; its
 * sentences may not. Pure, exported for the test.
 */
export function screenState(document: StructureDocumentInput): Record<string, unknown> {
  return {
    course: `${document.courseCode ?? ''} ${document.title}`.trim(),
    textbooks: document.textbooks?.length ?? 0,
    units: document.units.slice(0, 20).map((unit) => ({
      unit: unit.label ? `${unit.label}: ${unit.heading}` : unit.heading,
      topics: unit.topics.slice(0, 4),
    })),
  };
}

const SCREEN_TOOL = 'report_syllabus_check';

async function screenWithHaiku(
  document: StructureDocumentInput,
  client: Anthropic,
  onSpend?: SpendSink,
): Promise<boolean> {
  const response = await client.messages.create({
    model: UT_SCREEN_MODEL,
    max_tokens: 256,
    system: `${SCREEN_QUESTION.question} Answer through ${SCREEN_TOOL}.`,
    tools: [
      {
        name: SCREEN_TOOL,
        description: 'Whether the document is a syllabus with a schedule of topics.',
        input_schema: {
          type: 'object',
          properties: { syllabus_with_schedule: { type: 'boolean' } },
          required: ['syllabus_with_schedule'],
        },
      },
    ],
    tool_choice: forceTool(SCREEN_TOOL, UT_SCREEN_MODEL),
    messages: [{ role: 'user', content: JSON.stringify(screenState(document)) }],
  });
  onSpend?.({ model: UT_SCREEN_MODEL, usage: usageFrom(response.usage) });
  const block = response.content.find((part) => part.type === 'tool_use' && part.name === SCREEN_TOOL);
  if (!block || block.type !== 'tool_use') throw new Error(whyNoReport(response));
  return (block.input as { syllabus_with_schedule?: unknown }).syllabus_with_schedule === true;
}

export type ScreenOptions = {
  /** The account has opted in to Jev (lib/jev/enabled.ts). False sends nothing to TypeSafe. */
  jevEnabled: boolean;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  /** Defaults to TYPESAFE_API_KEY; passed in tests. */
  jevApiKey?: string | null;
  jevFetch?: typeof fetch;
};

/** Jev first at the 0.8 floor, Haiku below it or when Jev is off for the account. */
export function syllabusScreen(options: ScreenOptions): (document: StructureDocumentInput) => Promise<boolean> {
  return async (document) => {
    const client = options.client ?? new Anthropic({ apiKey: options.anthropicApiKey });
    const decided = await decideWithJev({
      state: screenState(document),
      question: SCREEN_QUESTION,
      read: (answer) => answer.yes,
      fallback: () => screenWithHaiku(document, client, options.onSpend),
      onSpend: options.onSpend,
      enabled: options.jevEnabled,
      apiKey: options.jevApiKey,
      fetch: options.jevFetch,
    });
    return decided.value;
  };
}

// ---------------------------------------------------------------------------
// Running a search and storing what it finds

export type UtPullLine =
  | {
      status: 'stored';
      itemId: string;
      url: string;
      courseCode: string;
      term: string;
      units: number;
      textbooks: string[];
      unchanged: boolean;
    }
  /** A Simple Syllabus page: it needs JavaScript, so it is named and never fetched. */
  | { status: 'not-fetchable'; url: string; courseCode: string; term: string; title: string }
  | { status: 'no-schedule'; url: string; courseCode: string; term: string }
  | { status: 'screened-out'; url: string; courseCode: string; term: string }
  | { status: 'failed'; detail: string };

export type UtSearchPull = {
  department: string;
  title: string;
  /** Terms whose results page was read. */
  termsRead: number;
  lines: UtPullLine[];
};

/** The ports a pull runs through, so a test can run one without the web or a database. */
export type UtPullPorts = {
  search: (search: UtSearch) => Promise<string | null>;
  fetchSyllabus: (url: string) => Promise<string | null>;
  /** Null stores without a screen: the parse's three-unit floor is then the only check. */
  screen: ((document: StructureDocumentInput) => Promise<boolean>) | null;
  store: (document: StructureDocumentInput) => Promise<{ itemId: string; unchanged: boolean }>;
};

export function livePorts(
  sql: postgres.Sql,
  screen: UtPullPorts['screen'],
  onRefused?: UtRefused,
): UtPullPorts {
  return {
    search: (search) => fetchUtResults(search, onRefused),
    fetchSyllabus: (url) => fetchUtSyllabusText(url, onRefused),
    screen,
    store: (document) => storeStructure(sql, document),
  };
}

type Candidate = { row: UtResultRow; link: { kind: 'download'; id: string; url: string } };

/**
 * One search across the given terms, newest first: collect up to
 * MAX_SYLLABI_PER_SEARCH distinct syllabi, then download, parse, screen and
 * store each. Sections share a syllabus (one PDF for every section a lecturer
 * teaches), so a download is kept once by its id, and a course taught by the
 * same people in an earlier term is skipped for the newer one. Never throws
 * for one document: a document that fails is a line, and the next runs.
 */
export async function pullUtSearch(
  query: { department: string; title: string; terms: UtTerm[] },
  ports: UtPullPorts,
): Promise<UtSearchPull> {
  const lines: UtPullLine[] = [];
  const candidates: Candidate[] = [];
  const seenIds = new Set<string>();
  const seenCourses = new Set<string>();
  const seenSimple = new Set<string>();
  let termsRead = 0;

  for (const term of query.terms) {
    if (candidates.length >= MAX_SYLLABI_PER_SEARCH) break;
    const html = await ports.search({
      year: term.year,
      semester: term.semester,
      department: query.department,
      courseTitle: query.title,
    });
    if (html === null) continue;
    const results = parseUtResults(html);
    if (!results.searched) continue;
    termsRead += 1;
    for (const row of results.rows) {
      const link = row.syllabus;
      if (!link) continue;
      if (link.kind === 'simple-syllabus') {
        if (!seenSimple.has(link.url)) {
          seenSimple.add(link.url);
          lines.push({ status: 'not-fetchable', url: link.url, courseCode: row.courseCode, term: row.term, title: row.title });
        }
        continue;
      }
      const course = `${row.courseCode}|${row.title}|${row.instructors.join(',')}`.toLowerCase();
      if (seenIds.has(link.id) || seenCourses.has(course)) continue;
      seenIds.add(link.id);
      seenCourses.add(course);
      if (candidates.length < MAX_SYLLABI_PER_SEARCH) candidates.push({ row, link });
    }
  }

  for (const { row, link } of candidates) {
    const where = { url: link.url, courseCode: row.courseCode, term: row.term };
    try {
      const text = await ports.fetchSyllabus(link.url);
      if (!text) {
        lines.push({ status: 'failed', detail: `${link.url}: no text could be read from the syllabus.` });
        continue;
      }
      const parsed = parseSyllabus(text, termYear(row.term) ?? new Date().getUTCFullYear());
      if (parsed.units.length < MIN_UNITS) {
        lines.push({ status: 'no-schedule', ...where });
        continue;
      }
      const document = utSyllabusDocument(row, link, text, parsed);
      if (ports.screen && !(await ports.screen(document))) {
        lines.push({ status: 'screened-out', ...where });
        continue;
      }
      const stored = await ports.store(document);
      lines.push({
        status: 'stored',
        itemId: stored.itemId,
        ...where,
        units: document.units.length,
        textbooks: parsed.textbooks,
        unchanged: stored.unchanged,
      });
    } catch (error) {
      lines.push({ status: 'failed', detail: `${link.url}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { department: query.department, title: query.title, termsRead, lines };
}

/** Read the department codes the form offers; empty when the form could not be fetched. */
export async function readUtDepartments(onRefused?: UtRefused): Promise<UtDepartment[]> {
  const html = await fetchUtForm(onRefused);
  return html ? parseDepartments(html) : [];
}

export type UtGoalPull =
  | { ok: true; proposed: ProposedSearch[]; searches: UtSearchPull[] }
  | { ok: false; detail: string };

/** The provider for a goal: read the departments, propose, search, screen, store. */
export async function pullUtForGoal(input: {
  sql: postgres.Sql;
  goal: GoalToClassify;
  anthropicApiKey: string;
  jevEnabled: boolean;
  now?: Date;
  client?: Anthropic;
  onSpend?: SpendSink;
  onRefused?: UtRefused;
  departments?: UtDepartment[];
  ports?: UtPullPorts;
}): Promise<UtGoalPull> {
  const departments = input.departments ?? (await readUtDepartments(input.onRefused));
  if (departments.length === 0) return { ok: false, detail: 'The UT Austin syllabus form could not be read.' };
  const proposed = await proposeUtSearches({ ...input, departments });
  if (!proposed.ok) return proposed;
  const ports =
    input.ports ??
    livePorts(
      input.sql,
      syllabusScreen({
        jevEnabled: input.jevEnabled,
        anthropicApiKey: input.anthropicApiKey,
        client: input.client,
        onSpend: input.onSpend,
      }),
      input.onRefused,
    );
  const terms = recentTerms(input.now ?? new Date(), TERMS_SEARCHED);
  const searches: UtSearchPull[] = [];
  for (const search of proposed.searches) {
    searches.push(await pullUtSearch({ ...search, terms }, ports));
  }
  return { ok: true, proposed: proposed.searches, searches };
}
