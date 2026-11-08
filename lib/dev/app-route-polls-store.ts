import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import type { AppRouteQuery } from '@/lib/dev/app-route';
import { runOnce, type AppRoutePoll, type AppRoutePollPorts } from '@/lib/dev/app-route-polls';

/**
 * The background polls of lib/dev/app-route-polls.ts in public.app_route_polls
 * (migration 0316), with the service role. Rows are taken through
 * claim_app_route_polls, which reads only the owner's (core.dev_owner_id()),
 * and every write names the row's own user_id.
 */

type Row = Record<string, unknown>;

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const obj = (value: unknown): AppRouteQuery =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AppRouteQuery) : {};

export function pollFromRow(row: Row): AppRoutePoll {
  return {
    id: str(row.id),
    userId: str(row.user_id),
    askedBy: str(row.asked_by),
    path: str(row.path),
    thenQuery: obj(row.then_query),
    pollUntil: str(row.poll_until),
    everySeconds: Number(row.every_seconds) || 90,
    deadline: str(row.deadline),
    createdAt: str(row.created_at),
    calls: Number(row.calls) || 0,
    postToRef: typeof row.post_to_ref === 'string' ? row.post_to_ref : null,
    postToLabel: typeof row.post_to_label === 'string' ? row.post_to_label : null,
  };
}

export function appRoutePollPorts(): AppRoutePollPorts {
  const db = createServiceSupabase();
  // Each write names the row's person, read from the rows the claim returned.
  const owners = new Map<string, string>();
  const ownerOf = (id: string) => {
    const userId = owners.get(id);
    if (!userId) throw new Error('That poll was not taken in this pass.');
    return userId;
  };

  return {
    async claim(limit, leaseSeconds) {
      const { data, error } = await db.rpc('claim_app_route_polls', { p_limit: limit, p_lease_seconds: leaseSeconds });
      if (error) throw new Error(`Taking the due polls failed: ${error.message}`);
      const polls = ((data ?? []) as Row[]).map(pollFromRow);
      for (const poll of polls) owners.set(poll.id, poll.userId);
      return polls;
    },
    run: runOnce,
    async putOff({ id, calls, lastRunId, result, nextAt }) {
      const patch: Row = { calls, next_at: nextAt, claimed_until: null };
      if (lastRunId) patch.last_run_id = lastRunId;
      if (result !== undefined) patch.result = result;
      const { error } = await db.from('app_route_polls').update(patch).eq('id', id).eq('user_id', ownerOf(id)).eq('status', 'polling');
      if (error) throw new Error(`Putting the poll off failed: ${error.message}`);
    },
    async finish({ id, status, calls, lastRunId, result, error: why }) {
      const { error } = await db
        .from('app_route_polls')
        .update({
          status,
          calls,
          last_run_id: lastRunId,
          result: result ?? null,
          error: why ? why.slice(0, 2000) : null,
          claimed_until: null,
          finished_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', ownerOf(id))
        .eq('status', 'polling');
      if (error) throw new Error(`Closing the poll failed: ${error.message}`);
    },
    async comment({ userId, ref, body }) {
      const { error } = await db.schema('core').rpc('add_thread_turn', {
        p_user_id: userId,
        p_ref: ref,
        p_author: 'claude',
        p_body: body,
      });
      if (error) throw new Error(`The comment was not kept: ${error.message}`);
    },
    async say({ id, text }) {
      const { error } = await db.rpc('say_in_app_route_thread', { p_poll: id, p_text: text });
      if (error) throw new Error(`The chat line was not kept: ${error.message}`);
    },
  };
}
