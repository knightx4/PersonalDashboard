import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { sendToPerson, type PushPayload, type PushPorts, type PushSubscriptionRow } from '@/lib/push/send';
import { sendWebPush, vapidKeys } from '@/lib/push/web-push';
import { stopPressed, type ReplyRow } from './reply-state';

/**
 * The reads and writes behind an Ask Dash reply that keeps going when the
 * page goes (plan #2854.4; the rules are lib/talk/reply-state.ts). Every
 * call runs through the person's own core client and names their id, so a
 * chat that is not theirs is never reached. An Ask Dash chat's id is its ref.
 */

async function setReply(core: CoreSupabaseClient, userId: string, ref: string, patch: Record<string, unknown>) {
  const { error } = await core.from('conversations').update(patch).eq('user_id', userId).eq('id', ref).eq('subject_kind', 'ask');
  if (error) throw new Error(`Keeping where the reply stands failed: ${error.message}`);
}

/** The reply to the chat's last question has started; returns when, to read Stop against. */
export async function markAnswering(core: CoreSupabaseClient, userId: string, ref: string, now = new Date()): Promise<string> {
  const at = now.toISOString();
  await setReply(core, userId, ref, { reply_state: 'answering', reply_started_at: at, reply_stop_at: null, reply_error: null });
  return at;
}

/** The reply is kept: nothing is waiting any more. */
export async function markAnswered(core: CoreSupabaseClient, userId: string, ref: string): Promise<void> {
  await setReply(core, userId, ref, { reply_state: null, reply_stop_at: null, reply_error: null });
}

/** The reply could not be written; `error` is what the thread says. */
export async function markFailed(core: CoreSupabaseClient, userId: string, ref: string, error: string): Promise<void> {
  await setReply(core, userId, ref, { reply_state: 'failed', reply_stop_at: null, reply_error: error.slice(0, 2000) });
}

/** Stop pressed: the run writing the reply reads this and ends the answer. False when nothing was being written. */
export async function requestStop(core: CoreSupabaseClient, userId: string, ref: string, now = new Date()): Promise<boolean> {
  const { data, error } = await core
    .from('conversations')
    .update({ reply_stop_at: now.toISOString() })
    .eq('user_id', userId)
    .eq('id', ref)
    .eq('subject_kind', 'ask')
    .eq('reply_state', 'answering')
    .select('id');
  if (error) throw new Error(`Stopping the answer failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Whether Stop has been pressed on the reply started at `startedAt`. A failed read says no. */
export async function stopRequested(core: CoreSupabaseClient, userId: string, ref: string, startedAt: string): Promise<boolean> {
  const { data, error } = await core
    .from('conversations')
    .select('reply_stop_at')
    .eq('user_id', userId)
    .eq('id', ref)
    .maybeSingle();
  if (error) return false;
  return stopPressed(data as { reply_stop_at: string | null } | null, startedAt);
}

/** The chat's reply columns, or null when it is not theirs or not there. */
export async function readReply(core: CoreSupabaseClient, userId: string, ref: string): Promise<ReplyRow | null> {
  const { data, error } = await core
    .from('conversations')
    .select('reply_state, reply_started_at, reply_error')
    .eq('user_id', userId)
    .eq('id', ref)
    .eq('subject_kind', 'ask')
    .maybeSingle();
  if (error) throw new Error(`Reading where the reply stands failed: ${error.message}`);
  return (data as ReplyRow | null) ?? null;
}

/**
 * Send one notification to each of the person's subscribed browsers, through
 * their own client (they may read and delete their subscriptions). Never
 * throws: a notification that does not go leaves the reply in the chat.
 */
export async function notifyPerson(core: CoreSupabaseClient, userId: string, payload: PushPayload): Promise<void> {
  const keys = vapidKeys();
  if (!keys) return;
  const ports: PushPorts = {
    async subscriptions(user) {
      const { data, error } = await core.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user);
      if (error) throw new Error(error.message);
      return (data ?? []) as PushSubscriptionRow[];
    },
    send: (subscription, text) => sendWebPush(keys, subscription, text),
    async forget(ids) {
      await core.from('push_subscriptions').delete().eq('user_id', userId).in('id', ids);
    },
    async sent() {
      // last_sent_at is the service role's to write; nothing to keep here.
    },
  };
  try {
    await sendToPerson(ports, userId, payload, new Date());
  } catch (error) {
    console.error('the reply notification was not sent', error);
  }
}
