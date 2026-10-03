import type Anthropic from '@anthropic-ai/sdk';
import { toRef } from '@/lib/core/refs';

/**
 * Handing a request Ask Dash cannot do to the backup routine (plan #1402).
 *
 * Dash's tools are a short list: the lookups, four proposals and nothing
 * else. When the person asks for something outside them ("add a goal to
 * publish a song"), Dash used to say it could not. Now it calls `hand_off`:
 * the request is kept in core.dash_handoffs, Dash says it has passed it on,
 * and once the answer is written a Claude Code routine is started on it. The
 * routine follows .claude/skills/dash-backup, does the work through the
 * database, writes its reply into the same conversation, and files a note
 * naming the ability Dash lacked so it can be given to Dash directly.
 *
 * This file is the part with no database: the tool, reading its input, and
 * the brief the routine is started with.
 */

export const HAND_OFF_TOOL_NAME = 'hand_off';

export type DashHandoffStatus = 'pending' | 'fired' | 'done' | 'failed';

export type DashHandoff = {
  id: string;
  conversationId: string;
  /** Dash's turn that announced it; null until that turn is written. */
  turnId: string | null;
  request: string;
  /**
   * The row the request is about, as a ref (`schema.table:id`), when Dash
   * named one it had seen (plan #1568). That row reads "Dash is on it" while
   * the hand-off is open. Null when the request is not about one row.
   */
  subjectRef: string | null;
  status: DashHandoffStatus;
  runId: string | null;
  error: string | null;
  createdAt: string;
};

/** The longest request kept (dash_handoffs_request_ck). */
export const MAX_HANDOFF_REQUEST = 4000;

export const HAND_OFF_TOOL: Anthropic.Tool = {
  name: HAND_OFF_TOOL_NAME,
  description:
    "Pass a request on when the person asks you to do or change something and none of your other tools can do it: creating a goal, editing or completing a todo, adding a job application, filing a note, and the like. A routine with full access to their data does it within a few minutes and writes its reply into this conversation. Use it only for a request they actually made, never for a question you could answer by looking things up, and not for deleting anything, sending email or spending money. Write the request so it can be done without this conversation: what to create or change, with every name, date and detail they gave, and the refs of any rows a lookup returned for it.",
  input_schema: {
    type: 'object',
    properties: {
      request: {
        type: 'string',
        description:
          'What to do, complete on its own: "Create a goal \\"Make a new song and publish it on Spotify\\" in their Music area".',
      },
      about: {
        type: 'object',
        description:
          'The one row the request is about, when it is about one: a job application, role, todo, order or item a lookup returned, or the row the page shows. Its page then says Dash is on it until the reply comes. Leave it out when the request is about no single row, such as creating something new.',
        properties: {
          table: { type: 'string', description: 'The table the lookup returned, such as job_search.applications.' },
          ref: { type: 'string', description: 'The ref the lookup returned for the row.' },
        },
        required: ['table', 'ref'],
        additionalProperties: false,
      },
    },
    required: ['request'],
    additionalProperties: false,
  },
};

/** The longest subject ref kept (dash_handoffs_subject_ref_ck). */
const MAX_SUBJECT_REF = 200;

/**
 * The request out of the tool's input, or why it cannot be used, with the
 * row it is about as a ref. `seen` says whether a lookup in this
 * conversation returned the row, or the page showed it: a row Dash has not
 * seen is left out rather than refusing the request, so a made-up ref never
 * marks a row and the request is still passed on.
 */
export function handoffRequest(
  input: unknown,
  seen: (table: string, ref: string) => boolean = () => false,
): { ok: true; request: string; subjectRef: string | null } | { ok: false; error: string } {
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const request = typeof args.request === 'string' ? args.request.trim() : '';
  if (!request) return { ok: false, error: 'request is missing. Say what to do.' };
  if (request.length > MAX_HANDOFF_REQUEST) {
    return { ok: false, error: `request is ${request.length} characters; the most is ${MAX_HANDOFF_REQUEST}.` };
  }
  return { ok: true, request, subjectRef: subjectRefOf(args.about, seen) };
}

function subjectRefOf(about: unknown, seen: (table: string, ref: string) => boolean): string | null {
  if (!about || typeof about !== 'object') return null;
  const { table, ref } = about as Record<string, unknown>;
  if (typeof table !== 'string' || typeof ref !== 'string') return null;
  const t = table.trim();
  const r = ref.trim();
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(t) || !r || !seen(t, r)) return null;
  const subject = toRef(t, r);
  return subject.length <= MAX_SUBJECT_REF ? subject : null;
}

/** Said to the model when it hands off where there is nothing to hand to. */
export const NO_HANDOFF =
  'Nothing can be handed on from here: the backup routine is not set up on this deployment. Tell them in a sentence that you cannot do this yet.';

/** Said to the model once a hand-off is kept. */
export const HANDED_OFF =
  'Handed on. Tell them in a sentence that you have passed it on and the reply will appear in this conversation in a few minutes. Do not say it is done.';

/**
 * The turn the routine is started with: which hand-off, whose, and in which
 * conversation, then the request itself. The skill reads the row by its id,
 * so the request here is only for the run's own title.
 */
export function handoffBrief(handoff: Pick<DashHandoff, 'id' | 'conversationId' | 'request'>, userId: string): string {
  return [
    `Hand-off ${handoff.id}`,
    `user_id ${userId}`,
    `conversation ${handoff.conversationId}`,
    '',
    `Request: ${handoff.request}`,
  ].join('\n');
}
