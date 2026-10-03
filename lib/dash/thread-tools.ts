import type Anthropic from '@anthropic-ai/sdk';
import type { DashHandoffTool, DashTool, DashWriteTool } from './registry';

/**
 * The tools that belong to the row a thread hangs from (plan #1465, feature
 * #1462). A comment tagged @dash on a dev row, a goal or a role could already
 * do these before the threads moved onto the shared loop; now each is a tool
 * in the registry, offered only on a thread whose row is in its `subjects`.
 *
 * What each one does stays with the thread that knows the row: the dev
 * actions in lib/comments/act.ts, goal filing and dates in lib/goals/ask.ts,
 * the cover letter in lib/jobs/role-thread/ask.ts. A write here calls the
 * thread's own acts (`DashWriteContext.thread`), which record their writes in
 * core.dash_actions as they make them. A hand-off is routed by the loop to
 * the thread's `handOff`, which starts a session or a routine.
 *
 * Each write's name is the kind its record carries.
 */

/** The dev rows a comment can be written on (lib/comments/load.ts, COMMENT_TARGETS), by table. */
export const DEV_THREAD_TABLES = {
  step: 'public.plan_items',
  idea: 'public.ideas',
  raise: 'public.raised_items',
  note: 'public.feedback_items',
  spec: 'public.spec_sections',
  takeaway: 'public.inspiration_takeaways',
  change: 'public.spec_changes',
} as const;

/** A goal or a step under one. */
export const GOAL_THREAD_TABLE = 'goals.items';
/** A role in Jobs. */
export const ROLE_THREAD_TABLE = 'job_search.roles';

const DEV = Object.values(DEV_THREAD_TABLES);
const { step, idea, raise, note, change } = DEV_THREAD_TABLES;
const NOT_A_CHANGE = DEV.filter((table) => table !== change);

const THREAD_ONLY = 'That can only be done in the thread it belongs to. Answer in words.';

type Schema = Anthropic.Tool['input_schema'];

function write(name: string, subjects: readonly string[], description: string, input_schema: Schema): DashWriteTool {
  return {
    name,
    kind: 'write',
    subjects,
    definition: { name, description, input_schema },
    apply: async (ctx, input) => (ctx.thread ? ctx.thread(name, input) : { ok: false, error: THREAD_ONLY }),
  };
}

function handoff(name: string, subjects: readonly string[], description: string, input_schema: Schema): DashHandoffTool {
  return { name, kind: 'handoff', subjects, definition: { name, description, input_schema } };
}

const MODULE = {
  type: 'string',
  description: 'The workspace it is about, by id (dev, jobs, goals and so on); leave it out for the app as a whole.',
} as const;

/** The thread tools, in the order the model is sent them. */
export const THREAD_TOOLS: readonly DashTool[] = [
  write(
    'file_idea',
    DEV,
    'File a new idea on the ideas page, marked as your suggestion, when the comment tells you to ("file that as its own idea").',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: "The idea in the person's own terms, a sentence or two, readable among other ideas." },
        module: MODULE,
      },
      required: ['text'],
      additionalProperties: false,
    },
  ),
  write(
    'file_note',
    DEV,
    'Write a bug report or a feature request into the notes queue, filed open, when the comment says to write something up.',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What is wrong or what is wanted, in enough detail to work months later.' },
        kind: { type: 'string', enum: ['bug', 'feature'] },
      },
      required: ['text', 'kind'],
      additionalProperties: false,
    },
  ),
  write(
    'add_step',
    NOT_A_CHANGE,
    'Add a row to the build plan as a proposal for them to approve. On a plan step it goes beneath that step; anywhere else it is a feature at the top of the workspace named.',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Its name, short and plain.' },
        detail: { type: 'string', description: 'The paragraph under it, when there is one to write.' },
        module: MODULE,
      },
      required: ['text'],
      additionalProperties: false,
    },
  ),
  write(
    'reword',
    [step, idea, note, change],
    'Rewrite the row the comment is on: an idea, a bug note, a plan step\'s title, detail or done-when, or a proposed spec change\'s diff, title or why. The old wording is kept under your reply.',
    {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'The whole new wording, not an instruction about it. For a spec change\'s diff, the whole new unified diff, hunks starting "@@ @@", kept and removed lines copied exactly, at most 60 lines changed.',
        },
        field: {
          type: 'string',
          enum: ['title', 'detail', 'done_when', 'diff', 'why'],
          description: 'Which part: on a plan step title, detail or done_when; on a spec change diff, title or why. Leave out on an idea or a note.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  ),
  write(
    'build_step',
    NOT_A_CHANGE,
    'Write a new plan step ready to be worked and start a session building it now, when the comment tells you to do the work ("do it", "go ahead"). Use add_step instead when they are putting something on the plan for later.',
    {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Its name, short and plain.' },
        detail: { type: 'string', description: 'The paragraph under it.' },
        module: MODULE,
      },
      required: ['text'],
      additionalProperties: false,
    },
  ),
  handoff(
    'send_step',
    [step, raise],
    'Start a session building the plan step this comment is on now, or on a raise the step it names by number. A proposal, a question, a blocked step and a feature already being worked are refused.',
    {
      type: 'object',
      properties: { text: { type: 'string', description: 'On a raise, the step\'s number as "#342". Leave out on a step.' } },
      additionalProperties: false,
    },
  ),
  handoff(
    'pass_to_session',
    DEV,
    'Pass the comment to a session that can read the repository, when answering it or doing it needs the code read. The session writes into this thread.',
    {
      type: 'object',
      properties: {
        why: { type: 'string', description: 'One sentence saying what would have to be read.' },
        instruction: { type: 'boolean', description: 'True when they told you to do something, false when they asked a question.' },
      },
      required: ['why', 'instruction'],
      additionalProperties: false,
    },
  ),
  write(
    'file_goal_record',
    [GOAL_THREAD_TABLE],
    "File one record of facts the comment states into one of the goal's collections, as a draft for them to confirm. File only what the comment states; never guess or work out a value.",
    {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'The collection ref from the message, such as c1.' },
        values: {
          type: 'object',
          description: 'Values keyed by the field keys listed, each in the stored form given.',
          additionalProperties: true,
        },
      },
      required: ['collection', 'values'],
      additionalProperties: false,
    },
  ),
  write(
    'schedule_goal_step',
    [GOAL_THREAD_TABLE],
    'Set the due date of the step the comment is on, or put it on their Todo or take it off, when the comment asks.',
    {
      type: 'object',
      properties: {
        due_on: {
          anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }],
          description: 'YYYY-MM-DD, worked out from today; null clears the date. Leave out to keep it.',
        },
        on_todo: { type: 'boolean', description: 'Leave out to keep it as it is.' },
      },
      additionalProperties: false,
    },
  ),
  handoff(
    'take_step',
    [GOAL_THREAD_TABLE],
    'Start the goals routine on the step the comment is on, when they tell you to do it or get it ready ("draft this for me", "you do it"). A step of yours is worked; a step of theirs gets what they need and stays theirs.',
    { type: 'object', properties: {}, additionalProperties: false },
  ),
  handoff(
    'pass_to_routine',
    [GOAL_THREAD_TABLE],
    'Pass the comment to the goals routine, when it needs more than one reply: research on the web, reading their email, reshaping the steps, or watching a price on a page outside the app. Its reply lands in this thread.',
    {
      type: 'object',
      properties: { why: { type: 'string', description: 'One sentence saying what it needs.' } },
      required: ['why'],
      additionalProperties: false,
    },
  ),
  write(
    'write_cover_letter',
    [ROLE_THREAD_TABLE],
    "Write the role's cover letter, or change the one on file, when the comment asks. It replaces the letter on file, and the old one is kept under your reply.",
    {
      type: 'object',
      properties: {
        cover_letter: {
          type: 'string',
          description: 'The whole letter they would send, not a diff or an outline, keeping everything they did not ask to change.',
        },
        evidence_refs: { type: 'array', items: { type: 'string' }, description: 'The bank refs (e1, e2) it draws on.' },
        unsupported_claims: {
          type: 'array',
          items: { type: 'string' },
          description: 'Every factual claim in it no bank item carries, copied as it appears.',
        },
      },
      required: ['cover_letter'],
      additionalProperties: false,
    },
  ),
];

/** The names of the thread tools, in registry order. */
export const THREAD_TOOL_NAMES = THREAD_TOOLS.map((t) => t.name);
