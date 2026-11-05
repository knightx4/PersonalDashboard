import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { AskRef } from '@/lib/talk/ask-input';
import { stopAskReply } from '@/lib/talk/ask-request';

export const dynamic = 'force-dynamic';

/**
 * Stop the answer being written in one of the person's chats (plan #2854.4).
 *
 * Leaving the page no longer ends an answer (app/api/ask/route.ts), so Stop
 * is a press of its own: it marks the chat, and the run writing the answer,
 * which may be another function, reads the mark within a second and keeps
 * what it had written. The body is JSON naming the chat; the person comes
 * from the session, and the chat must be theirs.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Send the chat as JSON.' }, { status: 415 });
  }
  let ref: string;
  try {
    const body: unknown = await request.json();
    const parsed = AskRef.safeParse(body && typeof body === 'object' ? (body as Record<string, unknown>).conversationRef : null);
    if (!parsed.success) return NextResponse.json({ error: 'That chat is not there any more.' }, { status: 400 });
    ref = parsed.data;
  } catch {
    return NextResponse.json({ error: 'That chat is not there any more.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ stopped: await stopAskReply(ref) });
  } catch (error) {
    console.error('ask stop failed', error);
    return NextResponse.json({ error: 'The answer could not be stopped. Try again.' }, { status: 500 });
  }
}
