'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestDashDeps } from '@/lib/ask/clients';
import { createCoreClient } from '@/lib/core/auth/server';
import { toRef } from '@/lib/core/refs';
import { ROLE_THREAD_TABLE } from '@/lib/dash/thread-tools';
import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { askDashOnRole } from '@/lib/jobs/role-thread/ask';
import { threadDashInRequest } from '@/lib/talk/ask-request';
import { addThreadTurn } from '@/lib/thread/store';

export type PrepareState = { error: string | null; message?: string; href?: string };

const EventId = z.string().uuid();

/**
 * Prepare with Dash, on a request waiting on you on Today: a take-home, a
 * form to fill, a question to answer.
 *
 * It asks on the role's comment thread, as a comment tagged @dash would, so
 * the help lands where the rest of the role's conversation is and can be
 * followed up there. The question carries what the request was and the email
 * it came in, which Dash can open through its mail lookup; the role's
 * description, requirement map and evidence bank come with any reply on a
 * role (lib/jobs/role-thread/ask.ts).
 */
// latency: pending -- waits for Dash's reply, as a tagged comment does
export async function prepareWithDash(eventId: string): Promise<PrepareState> {
  const id = EventId.safeParse(eventId);
  if (!id.success) return { error: 'Could not tell which request that was.' };

  const user = await requireUser();
  const supabase = await createClient();
  const { data: event, error: readError } = await supabase
    .from('application_events')
    .select('summary, occurred_at, ingested_message_id, applications!inner ( roles!inner ( id ) )')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (readError || !event) return { error: 'That request could not be found.' };

  const roleId = (event.applications as unknown as { roles: { id: string } }).roles.id;
  const summary = (event.summary as string | null)?.trim() || 'the request in their last email';

  // The email the request came in, named so Dash can find and read it.
  let email = '';
  if (event.ingested_message_id) {
    const core = await createCoreClient();
    const { data: message } = await core
      .from('ingested_messages')
      .select('subject, from_address, received_at')
      .eq('id', event.ingested_message_id as string)
      .maybeSingle();
    if (message) {
      email = ` It came in the email "${message.subject ?? '(no subject)'}" from ${message.from_address ?? 'them'} on ${(message.received_at as string).slice(0, 10)}; read it for the details.`;
    }
  }

  const question =
    `Help me prepare for this: ${summary}${email} ` +
    'Say what it is testing and what a strong answer looks like for this role, ' +
    'give me a plan for the time it asks for, and name what from my evidence bank to draw on. ' +
    'Add a to-do for the deadline if the email gives one.';

  let commentId: string;
  try {
    commentId = await addThreadTurn(supabase, {
      userId: user.id,
      ref: toRef(ROLE_THREAD_TABLE, roleId),
      author: 'me',
      body: `@dash ${question}`,
    });
  } catch {
    return { error: 'The question could not be saved. Try again.' };
  }

  const asked = await askDashOnRole({
    client: supabase,
    userId: user.id,
    roleId,
    commentId,
    question,
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    dash: await requestDashDeps(user.id),
    dashThread: await threadDashInRequest(user.id),
  });

  revalidatePath(`/jobs/roles/${roleId}`);
  revalidatePath('/jobs');
  const href = `/jobs/roles/${roleId}?tab=notes`;
  return asked.ok ? { error: null, message: 'Dash replied on the role.', href } : { error: asked.error, href };
}
