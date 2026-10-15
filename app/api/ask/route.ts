import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { parseAskInput } from '@/lib/talk/ask-input';
import { askDashInRequest } from '@/lib/talk/ask-request';
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
 * Stop (plan #1899.5) is the browser ending the request: the request's
 * signal, or the stream being cancelled, aborts the answer, which ends the
 * model call in flight and keeps what Dash had written as the answer. The
 * browser then reads the kept answer back by the conversation the `asked`
 * line named. Leaving the page mid-answer ends it the same way.
 *
 * The person comes from the session and nowhere else; the body names only the
 * question, the conversation it continues, the page it was asked on, the filter
 * of a list sent with it (plan #1658), the rows added with @ and the workspace
 * the lookups are kept to (plan #1899.5), all
 * checked by parseAskInput. JSON only, so a form on another site cannot post
 * here without the browser asking first.
 *
 * The time budget is TIME_BUDGET_MS, forty seconds, with the answer call and
 * the writes after it; 300 matches the pages the action used to run under.
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
  );

  const stopping = new AbortController();
  const stop = () => stopping.abort();
  if (request.signal.aborted) stop();
  else request.signal.addEventListener('abort', stop, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A browser that went away leaves the stream closed; the answer is still
      // kept, and the question reopened from the list shows it.
      let open = true;
      const send = (line: AskStreamLine) => {
        if (!open) return;
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
          controller.close();
        } catch {
          // Already closed by the browser leaving.
        }
      };
      if (!checked.ok) {
        send({ result: { turns: [], error: checked.error } });
        end();
        return;
      }
      try {
        const result = await askDashInRequest({
          ...checked.input,
          signal: stopping.signal,
          onAsked: (asked) => send({ asked }),
          onLookup: (event) => {
            const lookup = lookupWire(event);
            if (lookup) send({ lookup });
          },
          onText: (text) => send({ text }),
        });
        // The list of past questions reads the table, so a new question or a new
        // answer has to show there the next time it is opened.
        if (result.conversation) revalidatePath('/ask');
        // A change Dash made in the answer shows on the pages that hold its row (plan #1440).
        for (const change of result.changes ?? []) {
          if (change.status === 'done') for (const path of changePaths(change)) revalidatePath(path);
        }
        send({ result });
      } catch {
        send({ result: { turns: [], error: 'Dash could not be asked. Check your connection and try again.' } });
      }
      end();
    },
    cancel() {
      // The browser stopped reading: Stop was pressed, or the page went.
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Each line has to reach the browser as it is written, not when the answer is.
      'x-accel-buffering': 'no',
    },
  });
}
