import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type postgres from 'postgres';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { storeStructureMaterial } from '@/lib/learn/catalogue/structure-material';
import { storeStructure } from '@/lib/learn/catalogue/structure-store';
import type { GoalToClassify } from '@/lib/learn/goal-kind';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import {
  fetchOcwCourseStructure,
  findOcwCourses,
  normaliseCourseNumber,
  ocwSitemapReader,
  OCW_PROVIDER_SLUG,
  type OcwCourseStructure,
  type OcwStructureRefused,
} from '@/lib/learn/providers/ocw-structure';

/**
 * Pulling MIT OpenCourseWare courses into the structure store for a goal
 * (plan #2247.3), the `ocw` provider in lib/learn/goal-kind.ts.
 *
 * Three moves, as the feature's rule says: a model proposes, a fetch confirms,
 * and only what was fetched is stored.
 *
 *   1. One Haiku call names up to five MIT course numbers that teach the goal.
 *   2. The OCW sitemap, one fetch, says which of them exist and where.
 *   3. Each confirmed course's page, syllabus, calendar, readings and lecture
 *      notes are fetched (five fetches at most), parsed, and stored as a
 *      structure document with its notes listed as material.
 *
 * `pullOcwCourse` is step 3 alone, for a course number somebody names.
 */

export const OCW_PROPOSE_MODEL = MODELS.learnStructurePropose;

/** Courses one goal proposes. More than this and the pulls cost more than they add. */
export const MAX_PROPOSED_COURSES = 5;

const TOOL_NAME = 'report_mit_courses';

const SYSTEM = `You name MIT courses whose syllabus would give the structure for one
person's learning goal. MIT OpenCourseWare publishes the syllabus and the
session-by-session calendar of many MIT courses.

Name up to ${MAX_PROPOSED_COURSES} MIT course numbers, best first, written the way MIT
writes them: "15.431", "11.001J", "6.006", "18.06", "14.01". Only name a
course you are confident MIT teaches under that number and that teaches this
subject as its main matter. Fewer good courses are better than more weak ones;
name none if no MIT course fits.

Report them through ${TOOL_NAME}, each with the course's title as you know it.`;

export type ProposedCourse = { number: string; title: string };

/**
 * Read the tool payload: each entry whose number is written like an MIT course
 * number, first mention kept, at most MAX_PROPOSED_COURSES. Pure, exported for
 * the test.
 */
export function readProposedCourses(input: unknown): ProposedCourse[] {
  const list = (input as { courses?: unknown } | null)?.courses;
  if (!Array.isArray(list)) return [];
  const out: ProposedCourse[] = [];
  for (const entry of list) {
    const e = entry as { number?: unknown; title?: unknown } | null;
    const number = typeof e?.number === 'string' ? normaliseCourseNumber(e.number) : null;
    if (!number || out.some((course) => course.number === number)) continue;
    const title = typeof e?.title === 'string' ? e.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    out.push({ number, title });
    if (out.length === MAX_PROPOSED_COURSES) break;
  }
  return out;
}

/** The user message for one goal. Exported for the test. */
export function describeGoal(goal: GoalToClassify): string {
  const about = goal.about?.trim();
  return `Goal: ${goal.name.trim()}${about ? `. ${about}` : ''}\n\nCall ${TOOL_NAME} with the MIT courses that teach it.`;
}

export type ProposeResult = { ok: true; courses: ProposedCourse[] } | { ok: false; detail: string };

export async function proposeOcwCourses(input: {
  goal: GoalToClassify;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<ProposeResult> {
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: OCW_PROPOSE_MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the MIT course numbers that teach this goal, best first.',
          input_schema: {
            type: 'object',
            properties: {
              courses: {
                type: 'array',
                maxItems: MAX_PROPOSED_COURSES,
                items: {
                  type: 'object',
                  properties: { number: { type: 'string' }, title: { type: 'string' } },
                  required: ['number', 'title'],
                },
              },
            },
            required: ['courses'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, OCW_PROPOSE_MODEL),
      messages: [{ role: 'user', content: describeGoal(input.goal) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { ok: false, detail: 'Rate limited.' };
    return { ok: false, detail: error instanceof Error ? error.message : 'The proposing call failed.' };
  }

  input.onSpend?.({ model: OCW_PROPOSE_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  return { ok: true, courses: readProposedCourses(block.input) };
}

export type OcwPullLine =
  | { number: string; status: 'stored'; itemId: string; courseUrl: string; units: number; material: number; unchanged: boolean }
  | { number: string; status: 'not-on-ocw' }
  | { number: string; status: 'no-structure'; courseUrl: string }
  | { number: string; status: 'failed'; detail: string };

/** The ports a pull runs through, so a test can run one without the web or a database. */
export type OcwPullPorts = {
  readSitemap: () => Promise<string | null>;
  fetchCourse: (courseUrl: string) => Promise<OcwCourseStructure | null>;
  store: (structure: OcwCourseStructure) => Promise<{ itemId: string; unchanged: boolean; material: number }>;
};

export function livePorts(sql: postgres.Sql, onRefused?: OcwStructureRefused): OcwPullPorts {
  return {
    readSitemap: ocwSitemapReader(onRefused),
    fetchCourse: (courseUrl) => fetchOcwCourseStructure(courseUrl, onRefused),
    store: async (structure) => {
      const stored = await storeStructure(sql, structure.document);
      const material = await storeStructureMaterial(sql, {
        structureItemId: stored.itemId,
        providerSlug: OCW_PROVIDER_SLUG,
        material: structure.material,
      });
      return { itemId: stored.itemId, unchanged: stored.unchanged, material: material.written };
    },
  };
}

/**
 * Confirm, fetch and store each course number, one line per number. Never
 * throws for one course: a course that fails is a line, and the next runs.
 */
export async function pullOcwCourses(numbers: readonly string[], ports: OcwPullPorts): Promise<OcwPullLine[]> {
  const lines: OcwPullLine[] = [];
  const found = await findOcwCourses(numbers, ports.readSitemap);
  for (const { number, offering } of found) {
    if (!offering) {
      lines.push({ number, status: 'not-on-ocw' });
      continue;
    }
    try {
      const structure = await ports.fetchCourse(offering.courseUrl);
      if (!structure) {
        lines.push({ number, status: 'no-structure', courseUrl: offering.courseUrl });
        continue;
      }
      const stored = await ports.store(structure);
      lines.push({
        number,
        status: 'stored',
        itemId: stored.itemId,
        courseUrl: offering.courseUrl,
        units: structure.document.units.length,
        material: stored.material,
        unchanged: stored.unchanged,
      });
    } catch (error) {
      lines.push({ number, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return lines;
}

/** Store one course somebody named by its number. */
export async function pullOcwCourse(
  sql: postgres.Sql,
  number: string,
  onRefused?: OcwStructureRefused,
): Promise<OcwPullLine> {
  const [line] = await pullOcwCourses([number], livePorts(sql, onRefused));
  return line ?? { number, status: 'failed', detail: `${number} is not written like an MIT course number.` };
}

export type OcwGoalPull = { ok: true; proposed: ProposedCourse[]; lines: OcwPullLine[] } | { ok: false; detail: string };

/** The provider for a goal: propose, confirm, store. */
export async function pullOcwForGoal(input: {
  sql: postgres.Sql;
  goal: GoalToClassify;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
  onRefused?: OcwStructureRefused;
  ports?: OcwPullPorts;
}): Promise<OcwGoalPull> {
  const proposed = await proposeOcwCourses(input);
  if (!proposed.ok) return proposed;
  const lines = await pullOcwCourses(
    proposed.courses.map((course) => course.number),
    input.ports ?? livePorts(input.sql, input.onRefused),
  );
  return { ok: true, proposed: proposed.courses, lines };
}
