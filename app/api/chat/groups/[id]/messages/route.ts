import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth/server';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import { sendGroupMessageInRequest } from '@/lib/you/group-burst-request';

export const dynamic = 'force-dynamic';

/**
 * Write in a group chat (plan #2879.1.2). Saves the message and answers
 * with its id; the bots' burst runs after the answer is sent and reaches the
 * thread through Realtime on you.advisor_messages, with each bot's typing on
 * you.advisor_chat_members.typing_until and reactions on
 * you.advisor_message_reactions.
 *
 * The body is JSON with `text`. The person comes from the session alone.
 *
 * A burst is at most six short texts with no lookups and three director
 * calls, which fits in 300 seconds; one that would not hands on to
 * /api/chat/groups/[id]/burst before its time runs out.
 */
export const maxDuration = 300;

const body = z.object({ text: z.string().min(1).max(MESSAGE_MAX) });
const id = z.string().uuid();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const chatId = id.safeParse((await params).id);
  if (!chatId.success) return NextResponse.json({ error: 'That group is not there.' }, { status: 404 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Send the message as JSON.' }, { status: 415 });
  }
  let parsed: z.infer<typeof body>;
  try {
    const checked = body.safeParse(await request.json());
    if (!checked.success) return NextResponse.json({ error: 'That message cannot be sent.' }, { status: 400 });
    parsed = checked.data;
  } catch {
    return NextResponse.json({ error: 'That message cannot be sent.' }, { status: 400 });
  }
  try {
    const result = await sendGroupMessageInRequest(
      user.id,
      { chatId: chatId.data, text: parsed.text },
      { origin: new URL(request.url).origin, cookie: request.headers.get('cookie') },
    );
    if (!result.saved) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ chatId: chatId.data, messageId: result.messageId });
  } catch (error) {
    console.error('group message not sent', error);
    return NextResponse.json({ error: 'Your message was not sent. Try again.' }, { status: 500 });
  }
}
