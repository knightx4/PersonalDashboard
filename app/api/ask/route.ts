import { revalidatePath } from 'next/cache';
import { after, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { parseAskInput } from '@/lib/talk/ask-input';
import { askDashInRequest } from '@/lib/talk/ask-request';
import { createCoreClient } from '@/lib/core/auth/server';
import type { AskDashResult } from '@/lib/dash/ask';
import { askReplyPayload } from '@/lib/talk/reply-state';
import { notifyPerson } from '@/lib/talk/reply-state-store';
import { changePaths } from '@/lib/ask/changes';
import { encodeStreamLine, lookupWire, type AskStreamLine } from '@/lib/talk/lookups';

export const dynamic = 'force-dynamic';

/**
 * Ask Dash with the lookups shown as they run (plan #1438) and the answer
 * shown as it is written (plan #1902).
 *
 * The sheet and /ask ask Dash here. A route handler rather than a server
 * action, which is where this used to be, because an action hands back one
 * value when it is finished and this has to say something while it works.
 * The body is newline-delimited JSON: an `asked` line once the question is
 * kept (plan #1899.5), a `lookup` line as each lookup starts
 * and as it finishes, a `text` line for each piece of the answer as Dash
 * writes it (plan #1902), then one `result` line holding the AskDashResult,
 * whose saved turn is the answer as kept.
 * lib/talk/lookups.ts writes and reads both.
 *
 * The answer runs on the server whatever the browser does (plan #2854.4).
 * Leaving the page closes the stream and nothing else: the answer is still
 * written and kept, the chat says where it stands (core.conversations
 * reply_state), and a notification opens the chat when the page that asked
 * has gone. Stop (plan #1899.5) is its own press, app/api/ask/stop, which
 * marks the chat; the run reads the mark, ends the model call in flight and
 * keeps what Dash had written as the answer, and the stream ends with it.
 * `retry` answers the chat's last question again, for Try again.
 *
 * The person comes from the session and nowhere else; the body names only the
 * question, the conversation it continues, the page it was asked on, the filter
 * of a list sent with it (plan #1658), the rows added with @, the workspace
 * the lookups are kept to (plan #1899.5) and whether to think it through
 * (plan #2789.10), all
 * checked by parseAskInput. JSON only, so a form on another site cannot post
 * here without the browser asking first.
 *
 * The time budget is TIME_BUDGET_MS, forty seconds, with the answer call and
 * the writes after it; 300 matches the pages the action used to run under,
 * and holds a thought-through answer's THINK_TIME_BUDGET_MS of 150.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Send the question as JSON.' }, { status: 415 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const checked = parseAskInput(
    body.question,
    body.conversationRef,
    body.page,
    body.files,
    user.id,
    body.list,
    body.rows,
    body.scope,
    body.think,
  );

  // The answer runs whether or not the browser stays (plan #2854.4): leaving
  // the page closes the stream and nothing else. `after` holds the function
  // open until the answer is kept, and Stop is a press of its own
  // (app/api/ask/stop/route.ts) that the run reads from the chat.
  let open = true;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const send = (line: AskStreamLine) => {
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(encodeStreamLine(line)));
    } catch {
      open = false;
    }
  };
  const end = () => {
    if (!open) return;
    open = false;
    try {
      controller?.close();
    } catch {
      // Already closed by the browser leaving.
    }
  };
  // Whether the page that asked is still reading: when it is not, the reply is announced.
  const watching = () => open && !request.signal.aborted;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      // The browser stopped reading: the page went. The answer carries on.
      open = false;
    },
  });

  const answering = (async () => {
    if (!checked.ok) {
      send({ result: { turns: [], error: checked.error } });
      end();
      return;
    }
    try {
      const result = await askDashInRequest({
        ...checked.input,
        retry: body.retry === true,
        onAsked: (asked) => send({ asked }),
        onLookup: (event) => {
          const lookup = lookupWire(event);
          if (lookup) send({ lookup });
        },
        onText: (text) => send({ text }),
      });
      // The list of past questions reads the table, so a new question or a new
      // answer has to show there the next time it is opened.
      if (result.conversation) revalidatePath('/chat/dash');
      // A change Dash made in the answer shows on the pages that hold its row (plan #1440).
      for (const change of result.changes ?? []) {
        if (change.status === 'done') for (const path of changePaths(change)) revalidatePath(path);
      }
      if (result.conversation && !watching()) await announceReply(user.id, result);
      send({ result });
    } catch (error) {
      console.error('ask failed', error);
      send({ result: { turns: [], error: 'Dash could not be asked. Check your connection and try again.' } });
    }
    end();
  })();
  after(() => answering);

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Each line has to reach the browser as it is written, not when the answer is.
      'x-accel-buffering': 'no',
    },
  });
}

/**
 * The reply landed, or failed, after the page that asked had gone (plan
 * #2854.4): a notification that opens the chat. Never throws.
 */
async function announceReply(userId: string, result: AskDashResult): Promise<void> {
  const ref = result.conversation?.ref;
  if (!ref) return;
  const answer = result.turns.findLast((turn) => turn.role === 'assistant');
  const outcome = answer && !result.error ? { answer: answer.body } : { error: result.error ?? 'Open the chat to see why.' };
  try {
    await notifyPerson(await createCoreClient(), userId, askReplyPayload(ref, outcome));
  } catch (error) {
    console.error('the reply notification was not sent', error);
  }
}
