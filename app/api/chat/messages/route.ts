import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth/server';
import { ATTACHMENTS_PER_ITEM, parseUploadedAttachments } from '@/lib/attachments/rules';
import { MESSAGE_MAX } from '@/lib/you/council-model';
import { sendMentorMessageInRequest } from '@/lib/you/mentor-reply-request';

export const dynamic = 'force-dynamic';

/**
 * Text a mentor (plan #2748.4). Saves the message, shows the mentor typing,
 * and answers with the chat and the message's id; the reply is written after
 * the answer is sent and reaches the thread through Realtime on
 * you.advisor_messages, with typing on you.advisor_chats.typing_until.
 *
 * The body is JSON: `advisorId`, `text`, `noteId` when the message is
 * about one of the mentor's notes, and `files` (plan #2974): the pictures and
 * PDFs the browser already put in the person's folder of the attachments
 * bucket, recorded against the message. With files the text may be empty.
 * The person comes from the session alone.
 *
 * A reply runs Dash's loop with its forty-second budget, and a message sent
 * while the mentor is typing is answered in the same run once the reply in
 * hand is done, so the run can outlast one answer; 300 seconds covers three.
 */
export const maxDuration = 300;

const body = z.object({
  advisorId: z.string().uuid(),
  text: z.string().max(MESSAGE_MAX),
  noteId: z.string().uuid().nullish(),
  files: z.array(z.unknown()).max(ATTACHMENTS_PER_ITEM).optional(),
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
  // Only files in the person's own folder, of a type the store takes, are kept.
  const files = parseUploadedAttachments(parsed.files ?? [], user.id);
  if ((parsed.files?.length ?? 0) !== files.length) {
    return NextResponse.json({ error: 'One of those files cannot be sent. Remove it and try again.' }, { status: 400 });
  }
  if (!parsed.text.trim() && files.length === 0) {
    return NextResponse.json({ error: 'Write a message or add a file.' }, { status: 400 });
  }
  try {
    const result = await sendMentorMessageInRequest(user.id, { ...parsed, files });
    if (!result.saved) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ chatId: result.chatId, messageId: result.messageId, files: result.files ?? [] });
  } catch (error) {
    console.error('chat message not sent', error);
    return NextResponse.json({ error: 'Your message was not sent. Try again.' }, { status: 500 });
  }
}
