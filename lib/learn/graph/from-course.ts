import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import {
  chainPayloadSchema,
  normaliseChain,
  whyMalformed,
  MAX_CHAIN,
  type ExistingConcept,
  type ProposedChain,
} from '@/lib/learn/graph/chain-payload';
import { KIND_RULE, KIND_TOOL_FIELD } from '@/lib/learn/graph/kind-prompt';
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';
import { NODE_RULE } from '@/lib/learn/graph/position-prompt';

/**
 * The ideas a course on your transcript probably covered (plan #1390, under
 * #1388).
 *
 * from-prior.ts refuses a list of course titles on purpose: a title shows you
 * attended, not what you understood. This call does the opposite, and says so
 * on every idea it returns. It writes down what a course with this title, code
 * and level usually teaches, each basis names the course it came from, and the
 * person's tick on the check screen is the safeguard. What they approve is
 * declared known and comes back as a review question after a month, the same
 * as anything else declared.
 *
 * Nothing here writes. The approval is #1391's, through saveChain and
 * declareKnown as approvePrior does.
 */

const MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'report_chain';

/** The course as the vault keeps it, only the parts the call reads. */
export type CourseForReading = {
  school: string;
  code: string | null;
  title: string;
  term: string | null;
  year: number | null;
  grade: string | null;
};

/**
 * The course in one line, as it is shown on each idea: code, title, term and
 * year, grade. "ECON 201, Intermediate Macroeconomics, Fall 2017, grade B+".
 * A term that already carries its year is not given the year twice.
 */
export function courseLabel(course: CourseForReading): string {
  const parts: string[] = [];
  if (course.code?.trim()) parts.push(course.code.trim());
  parts.push(course.title.trim());

  const term = course.term?.trim() ?? '';
  const year = course.year === null ? '' : String(course.year);
  const when = term && year && !term.includes(year) ? `${term} ${year}` : term || year;
  if (when) parts.push(when);

  if (course.grade?.trim()) parts.push(`grade ${course.grade.trim()}`);
  return parts.join(', ');
}

/**
 * Words that name a kind of course rather than its content. A title made of
 * nothing else ("Special topics", "Independent study II", "Senior thesis")
 * says nothing about what was taught, so it is answered without a call.
 */
const GENERIC_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'in', 'on', 'for', 'to',
  'special', 'selected', 'current', 'advanced', 'topic', 'topics',
  'independent', 'individual', 'directed', 'supervised', 'guided',
  'study', 'studies', 'reading', 'readings', 'research', 'seminar',
  'thesis', 'dissertation', 'internship', 'practicum', 'placement',
  'project', 'projects', 'capstone', 'honors', 'honours', 'tutorial',
  'workshop', 'colloquium', 'fieldwork', 'field', 'work', 'experience',
  'senior', 'junior', 'graduate', 'undergraduate', 'course', 'elective',
  'general', 'transfer', 'credit', 'credits', 'abroad', 'exchange',
  'lab', 'laboratory', 'module', 'unit', 'part', 'level',
  'i', 'ii', 'iii', 'iv', 'v',
]);

/** Whether a title says too little to guess from, before any call is made. */
export function isVagueTitle(title: string): boolean {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '' && !/^\d+$/.test(word));
  return words.every((word) => GENERIC_WORDS.has(word));
}

/** What a vague title gets instead of a list. Shown to the person. */
export function vagueTitleMessage(course: CourseForReading): string {
  return `"${course.title.trim()}" does not say what the course covered, so Dash would be guessing. Write what you took from it in "Or start from what you already know" instead.`;
}

const SYSTEM = `Somebody has passed a university course and wants the ideas it taught added
to a graph of what they know. You are given the course as their transcript
lists it: school, code, title, term, grade. You do not have the syllabus.

Your job is to write down the handful of ideas a course with this title, at
this level, almost always teaches. They will read your list and untick what
they do not really know before anything is saved, so the list is a proposal
for them to check, not a claim about them.

${NODE_RULE}

THE CORE, NOT THE EDGES. Propose what any course with this title would cover,
not what one lecturer might have added. "Intermediate Macroeconomics" covers
the IS-LM model and the Phillips curve almost everywhere; it does not reliably
cover a particular paper.

THE LEVEL. Pitch each idea at the level the code and title suggest. A
100-level or "Introduction to" course states the core results; a 300-level or
"Advanced" course works with them. Do not propose graduate material for a
first-year course.

FEW. One to eight, never more than ${MAX_CHAIN}.

EDGES. Join them to each other where one rests on the other, and to the
concepts the subject already holds, which you are given by name. Nothing goes
in the graph without an edge.

DO NOT REPROPOSE what the subject already has. Name it exactly as given and
draw the edge instead.

${MASTERY_RULE}

${KIND_RULE}

BASIS. Each node and edge carries one short sentence on why it belongs. For a
node, say why a course like this teaches it ("the central model of any
intermediate macro course"). The course itself is named for you, so do not
repeat its title.

SUBJECT. Name the subject this course belongs in, something one survey course
could cover. Economics yes, Machine learning yes, Science no. If you are given
a subject, use it. If you are given their existing tracks, use one of those
names exactly when the course fits it.

IF THE TITLE SAYS TOO LITTLE to tell what was taught -- "Special topics",
"Independent study", "Senior seminar", a title that is only a code -- set
too_vague true and propose nothing.`;

export type FromCourseResult =
  | { ok: true; chain: ProposedChain }
  | {
      ok: false;
      /**
       * too-vague: the title gives nothing to go on, so no list.
       * nothing-new: every idea it would propose is already in the track.
       * error: the call failed.
       */
      reason: 'too-vague' | 'nothing-new' | 'error';
      detail: string;
    };

export async function conceptsFromCourse(input: {
  course: CourseForReading;
  /** The track the person picked. Null lets the model choose or name one. */
  subject: string | null;
  /** What the picked track already holds. Empty when none was picked. */
  existing: ExistingConcept[];
  /**
   * Their track names, offered when none was picked, so a course goes into a
   * track they already have when one fits.
   */
  tracks?: string[];
  /**
   * What a track already holds, by name. Asked only when no track was picked
   * and the model chose one of `tracks`, so its ideas are not proposed again.
   */
  existingIn?: (track: string) => Promise<ExistingConcept[]>;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<FromCourseResult> {
  const { course } = input;

  // Answered without a call: there is nothing in "Special topics" for the
  // model to read, and guessing would cost money and fill the list with noise.
  if (isVagueTitle(course.title)) {
    return { ok: false, reason: 'too-vague', detail: vagueTitleMessage(course) };
  }

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const lines: string[] = [];
  if (input.subject) lines.push(`Subject: ${input.subject}`, '');
  lines.push(
    'The course:',
    `- School: ${course.school}`,
    `- Code: ${course.code?.trim() || 'not given'}`,
    `- Title: ${course.title}`,
    `- Term: ${[course.term, course.year].filter(Boolean).join(' ') || 'not given'}`,
    `- Grade: ${course.grade?.trim() || 'not given'}`,
  );

  if (!input.subject && input.tracks && input.tracks.length > 0) {
    lines.push('', 'Their existing tracks:', ...input.tracks.map((name) => `- ${name}`));
  }
  if (input.existing.length > 0) {
    lines.push(
      '',
      'Concepts this subject already holds — name these exactly as written rather than restating them:',
      ...input.existing.map((concept) => `- ${concept.name}`),
    );
  }
  lines.push(
    '',
    `Call ${TOOL_NAME}, with goal_concept set to the idea the course is most centrally about.`,
  );

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the ideas a course like this usually teaches.',
          input_schema: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              goal_concept: { type: 'string' },
              too_vague: { type: 'boolean' },
              concepts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    claim: { type: 'string' },
                    basis: { type: 'string' },
                    mastery: MASTERY_TOOL_FIELD,
                    kind: KIND_TOOL_FIELD,
                  },
                  required: ['name', 'claim', 'basis', 'mastery', 'kind'],
                },
              },
              edges: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prerequisite: { type: 'string' },
                    dependent: { type: 'string' },
                    basis: { type: 'string' },
                  },
                  required: ['prerequisite', 'dependent', 'basis'],
                },
              },
            },
            required: ['subject', 'goal_concept', 'concepts', 'edges'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Reading that course failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const safe = chainPayloadSchema.safeParse(block.input);
  if (!safe.success) {
    return { ok: false, reason: 'error', detail: whyMalformed(safe.error) };
  }
  if (safe.data.too_vague) {
    return { ok: false, reason: 'too-vague', detail: vagueTitleMessage(course) };
  }

  // With no track picked, a course the model put into one of theirs is
  // matched against what that track holds, under the track's own spelling.
  let payload = safe.data;
  let existing = input.existing;
  if (!input.subject && input.tracks && input.existingIn) {
    const named = payload.subject.trim().toLowerCase();
    const track = input.tracks.find((name) => name.trim().toLowerCase() === named);
    if (track) {
      payload = { ...payload, subject: track };
      existing = await input.existingIn(track);
    }
  }

  const chain = normaliseChain(payload, existing);
  if (!chain) {
    return {
      ok: false,
      reason: 'nothing-new',
      detail: `Dash found nothing from ${course.title.trim()} that the subject does not already hold.`,
    };
  }

  return { ok: true, chain: nameTheCourse(chain, course) };
}

/** A basis is at most 500 characters when it comes back for approval. */
const BASIS_MAX = 500;

/**
 * Put the course on every idea it proposes, so the check screen and the
 * concept's page both say where it came from: "From ECON 201, Intermediate
 * Macroeconomics, Fall 2017, grade B+. The central model of the course." An
 * idea the track already held keeps its own basis, since nothing is written
 * for it.
 */
export function nameTheCourse(chain: ProposedChain, course: CourseForReading): ProposedChain {
  const from = `From ${courseLabel(course)}.`;
  return {
    ...chain,
    nodes: chain.nodes.map((node) => {
      if (node.existingId) return node;
      const basis = node.basis ? `${from} ${node.basis}` : from;
      return { ...node, basis: basis.slice(0, BASIS_MAX) };
    }),
  };
}
