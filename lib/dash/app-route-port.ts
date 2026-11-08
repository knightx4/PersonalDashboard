import 'server-only';

import { createServiceSupabase, createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { runAppRoute } from '@/lib/dev/app-route';
import { isOwner } from '@/lib/dev/owner';
import type { AppRouteReplyTo, DashAppRoutePort, NewAppRoutePoll } from './app-route-writes';

/**
 * run_app_route's port inside a request (lib/dash/app-route-writes.ts): the
 * owner check on the signed-in session, the runner, and the poll row and the
 * comment written with the service role, since app_route_polls is read-only
 * to a signed-in account. Every write names the person, who is the owner by
 * then.
 */

export async function keepAppRoutePoll(poll: NewAppRoutePoll): Promise<string> {
  const db = createServiceSupabase();
  const reply = poll.replyTo;
  const { data, error } = await db
    .from('app_route_polls')
    .insert({
      user_id: poll.userId,
      asked_by: poll.askedBy,
      path: poll.path,
      query: poll.query,
      then_query: poll.thenQuery,
      poll_until: poll.pollUntil,
      every_seconds: poll.everySeconds,
      deadline: poll.deadline,
      next_at: poll.nextAt,
      calls: poll.calls,
      last_run_id: poll.lastRunId,
      result: poll.result ?? null,
      post_to_ref: poll.postToRef,
      post_to_label: poll.postToLabel,
      conversation_id: reply && 'conversationId' in reply ? reply.conversationId : null,
      advisor_chat_id: reply && 'advisorChatId' in reply ? reply.advisorChatId : null,
      advisor_id: reply && 'advisorId' in reply ? reply.advisorId : null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`The poll was not kept: ${error?.message ?? 'no id came back'}`);
  return (data as { id: string }).id;
}

async function commentAsDash(input: { userId: string; ref: string; body: string }): Promise<void> {
  const { error } = await createServiceSchemaSupabase('core').rpc('add_thread_turn', {
    p_user_id: input.userId,
    p_ref: input.ref,
    p_author: 'claude',
    p_body: input.body,
  });
  if (error) throw new Error(`The comment was not kept: ${error.message}`);
}

/** The bot's key, for `bot:<key>` on the run log; its id when it cannot be read. */
async function botName(userId: string, advisorId: string): Promise<string> {
  try {
    const { data } = await createServiceSchemaSupabase('you')
      .from('board_advisors')
      .select('key, name')
      .eq('user_id', userId)
      .eq('id', advisorId)
      .maybeSingle();
    const row = data as { key?: unknown; name?: unknown } | null;
    if (typeof row?.key === 'string' && row.key) return row.key;
    if (typeof row?.name === 'string' && row.name) return row.name;
  } catch {
    // The id still names who asked.
  }
  return advisorId;
}

/** The port for Ask Dash (a conversation), a People thread (a bot), or a row thread (no chat line). */
export function appRoutePortInRequest(userId: string, replyTo: AppRouteReplyTo): () => Promise<DashAppRoutePort> {
  return async () => {
    const askedBy = replyTo && 'advisorId' in replyTo ? `bot:${await botName(userId, replyTo.advisorId)}` : 'dash';
    return {
      isOwner: await isOwner(),
      askedBy,
      replyTo,
      run: (input) => runAppRoute(input),
      keepPoll: keepAppRoutePoll,
      comment: commentAsDash,
    };
  };
}
