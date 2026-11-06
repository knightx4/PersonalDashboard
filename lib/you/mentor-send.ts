import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import { filesOnlyText, type ThreadFile } from '@/lib/you/chat-threads-model';
import { markNotesRead } from '@/lib/you/council';
import { cleanMessage, type Mentor } from '@/lib/you/council-model';
import { claimTyping } from '@/lib/you/mentor-reply';

/**
 * The person texting a mentor (plan #2748.4): find or start their thread,
 * save the message, and show the mentor typing. The reply is written after
 * the send has answered (lib/you/mentor-reply.ts), by whoever holds the
 * typing claim: this send when it took it, or the reply already being
 * written, which answers this message once it has finished the one before.
 */

export type MentorSent =
  | { error: string; saved: false }
  | {
      error: null;
      saved: true;
      chatId: string;
      messageId: string;
      /** True when this send holds the reply and must start it; false when one is already being written. */
      claimed: boolean;
      /** The files recorded against the message (plan #2974); empty when none came with it. */
      files: ThreadFile[];
    };

export async function sendMentorText(input: {
  client: YouSupabaseClient;
  userId: string;
  mentor: Pick<Mentor, 'id' | 'name' | 'canTalk'>;
  text: string;
  noteId?: string | null;
  /** Pictures and PDFs already in the person's folder, sent with the message (plan #2974). */
  files?: readonly UploadedAttachment[];
  /** Records the files against the saved message; given whenever `files` is. */
  recordFiles?: (messageId: string, files: readonly UploadedAttachment[]) => Promise<ThreadFile[]>;
  now?: number;
}): Promise<MentorSent> {
  const { client, userId, mentor } = input;
  const now = input.now ?? Date.now();
  const files = input.files ?? [];
  // A message of files alone is saved as their names, since a message's text is never empty.
  const words = input.text.trim() || (files.length > 0 ? filesOnlyText(files.map((f) => f.name)) : '');
  const clean = cleanMessage(words);
  if (!clean.ok) return { error: clean.error, saved: false };
  if (!mentor.canTalk) return { error: `${mentor.name} cannot talk until their brain is built.`, saved: false };

  const found = await client
    .from('advisor_chats')
    .select('id')
    .eq('user_id', userId)
    .eq('advisor_id', mentor.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  let chatId = typeof found.data?.id === 'string' ? found.data.id : null;
  if (!chatId) {
    const made = await client
      .from('advisor_chats')
      .insert({ user_id: userId, advisor_id: mentor.id, title: `Talking with ${mentor.name}`.slice(0, 200) })
      .select('id')
      .single();
    if (made.error || typeof made.data?.id !== 'string') throw new Error(made.error?.message ?? 'Could not start the talk.');
    chatId = made.data.id;
  }

  const message = await client
    .from('advisor_messages')
    .insert({ user_id: userId, chat_id: chatId, role: 'person', text: clean.text, note_id: input.noteId ?? null })
    .select('id')
    .single();
  if (message.error || typeof message.data?.id !== 'string') {
    throw new Error(`Your message was not saved: ${message.error?.message ?? 'no row came back'}`);
  }
  if (input.noteId) await markNotesRead(client, userId, [input.noteId], now);
  // Recorded before the typing is claimed, so the reply finds them.
  const recorded = files.length > 0 && input.recordFiles ? await input.recordFiles(message.data.id, files) : [];

  const claimed = await claimTyping(client, userId, chatId, now);
  return { error: null, saved: true, chatId, messageId: message.data.id, claimed, files: recorded };
}
