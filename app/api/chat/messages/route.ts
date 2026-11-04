import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth/server';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import { sendMentorMessageInRequest } from '@/lib/you/mentor-reply-request';

export const dynamic = 'force-dynamic';

/**
 * Text a mentor (plan #2748.4). Saves the message, shows the mentor typing,
 * and answers with the chat and the message's id; the reply is written after
 * the answer is sent and reaches the thread through Realtime on
 * you.advisor_messages, with typing on you.advisor_chats.typing_until.
 *
 * The body is JSON: `advisorId`, `text`, and `noteId` when the message is
 * about one of the mentor's notes. The person comes from the session alone.
 *
 * A reply runs Dash's loop with its forty-second budget, and a message sent
 * while the mentor is typing is answered in the same run once the reply in
 * hand is done, so the run can outlast one answer; 300 seconds covers three.
 */
export const maxDuration = 300;

const body = z.object({
  advisorId: z.string().uuid(),
  text: z.string().min(1).max(MESSAGE_MAX),
  noteId: z.string().uuid().nullish(),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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
    const result = await sendMentorMessageInRequest(user.id, parsed);
    if (!result.saved) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ chatId: result.chatId, messageId: result.messageId });
  } catch (error) {
    console.error('chat message not sent', error);
    return NextResponse.json({ error: 'Your message was not sent. Try again.' }, { status: 500 });
  }
}
