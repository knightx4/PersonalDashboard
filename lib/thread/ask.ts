/**
 * Dash's reply to a comment tagged @dash under any row (plan #1441).
 *
 * The dev rows, goals and roles each have their own reply
 * (lib/comments/ask.ts, lib/goals/ask.ts, lib/jobs/role-thread/ask.ts),
 * because each has tools only it can offer. Every other thread is answered
 * here, keyed by nothing but the row's ref: the row is read whole as the
 * person's session sees it (readSubject) and written out from its catalogue
 * entry (lib/thread/row-text.ts), the thread so far comes from the shared
 * store, and the reply runs the shared loop (lib/dash/thread.ts) with Ask
 * Dash's lookups and writes. A file is the first thread on it; a thread
 * added under any other table gets the same replies without code of its own.
 *
 * The same rule as the other three: every outcome is written into the
 * thread, including the ones where nothing could be done.
 */
import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { readSubject, type DashActionDeps } from '@/lib/core/dash-actions';
import { pageTitle, parseRef } from '@/lib/core/refs';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { askMessage } from '@/lib/comments/context';
import { DASH_MODELS } from '@/lib/dash/models';
import { replyInThread, subjectLine, threadVoice, type ThreadDash } from '@/lib/dash/thread';
import { pageFor } from '@/lib/sources/catalogue';
import { whyNotRead } from '@/lib/vault/map/rules';
import { acknowledgeThreadTurn, addThreadTurn, loadThread, type AnyClient } from './store';
import { rowText } from './row-text';

/** The model a reply under any other row is written with. */
export const ROW_REPLY_MODEL = DASH_MODELS.rowThread;

/** What a reply here is told, after the rules every thread shares. */
const ROW_RULES = `The message gives the row this thread is on, column by column, under "The
row", with what the table holds. A question about what the row says is
answered from it, quoting it where the wording matters. This row has no tools
of its own: a change to it, or to anything else, is made with the shared
tools above, and only when they ask for one.`;

export type RowAskInput = {
  /** Any of the person's clients; the thread is read and written through `.schema('core')`. */
  client: AnyClient;
  userId: string;
  /** The row the thread is on, `schema.table:id`. */
  ref: string;
  /** The comment carrying the question, left out of the history. */
  commentId: string;
  question: string;
  apiKey: string | null;
  /** The person's clients: the row is read through `dash.db`. */
  dash: DashActionDeps;
  /** The person's lookups and writes, for the shared loop (threadDashInRequest). */
  dashThread: ThreadDash;
  /** For tests: the model client. */
  anthropic?: Anthropic;
};

export type RowAskOutcome = { ok: true; message: string } | { ok: false; error: string };

async function say(input: RowAskInput, body: string): Promise<void> {
  await addThreadTurn(input.client, { userId: input.userId, ref: input.ref, author: 'claude', body });
}

export async function askDashOnRow(input: RowAskInput): Promise<RowAskOutcome> {
  try {
    return await produceReply(input);
  } catch (error) {
    const why =
      'Something went wrong on the way to a reply: ' +
      `${error instanceof Error ? error.message : 'no reason given'}. Your comment is saved.`;
    try {
      await say(input, why);
    } catch {
      /* the action's own message is the only copy left */
    }
    return { ok: false, error: why };
  }
}

async function produceReply(input: RowAskInput): Promise<RowAskOutcome> {
  const refuse = async (why: string): Promise<RowAskOutcome> => {
    await say(input, why);
    return { ok: false, error: why };
  };

  const parsed = parseRef(input.ref);
  if (!parsed) return { ok: false, error: 'Could not tell which row the comment is on.' };

  const [row, thread] = await Promise.all([
    readSubject(input.dash.db, input.ref),
    loadThread(input.client, input.ref, { userId: input.userId }),
  ]);
  if (!row) return { ok: false, error: 'That row is no longer here, so nothing was asked.' };
  if (!input.apiKey) {
    return refuse('No ANTHROPIC_API_KEY on the deployment, so I cannot answer. Your comment is saved.');
  }

  // A vault note the map turns away (a journal, one carrying a key) is not
  // sent to a model from its thread either.
  const notRead = parsed.table === 'obsidian.notes' ? noteNotRead(row) : null;
  if (notRead) return refuse(`I do not read this note. ${notRead} Your comment is saved.`);

  const page = pageFor(parsed.table)?.page;
  const title = page ? pageTitle(page, row) : null;
  const message = askMessage({
    context: rowText(parsed.table, row),
    thread: thread.filter((turn) => turn.id !== input.commentId),
    question: input.question,
  });

  const spend: SpendReport[] = [];
  const reply = await replyInThread({
    voice: threadVoice(ROW_REPLY_MODEL, ROW_RULES, parsed.table),
    subject: { ref: input.ref, title },
    message: `${subjectLine(input.ref)}\n\n${message}`,
    dash: input.dashThread,
    acts: async () => ({ ok: false, error: 'This row has no tools of its own. Use the shared ones.' }),
    acknowledge: () =>
      acknowledgeThreadTurn(input.client, { userId: input.userId, ref: input.ref, turnId: input.commentId }),
    anthropicApiKey: input.apiKey,
    client: input.anthropic,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(input.userId, { module: 'core', operation: 'reply-to-comment' }, spend);
  if (!reply.ok) return refuse(`I could not produce a reply: ${reply.detail} Your comment is saved.`);

  if (reply.acknowledged) return { ok: true, message: 'Dash marked your comment as seen.' };
  await say(input, reply.body);
  return { ok: true, message: reply.made.length > 0 ? 'Done, and said in the thread.' : 'Answered in the thread.' };
}

/** Why a vault note is kept from a model, or null when it may be read. */
function noteNotRead(row: Readonly<Record<string, unknown>>): string | null {
  const path = typeof row.path === 'string' ? row.path : '';
  const body = typeof row.body === 'string' ? row.body : '';
  return whyNotRead({ path, body })?.detail ?? null;
}
