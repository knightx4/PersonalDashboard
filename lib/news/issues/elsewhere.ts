import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { NEWS_SCHEMA, type NewsSupabaseClient } from '@/lib/news/db/schema-name';
import type { AlsoIn } from '@/lib/news/quick/next';
import { elsewhereFrom } from './elsewhere-rows';
import { senderLabel } from './list';

/**
 * Where else each of a newsletter's stories ran (plan #865), for the "Also
 * in" line on the issue page: story position among the readable stories, as
 * story_groups numbers it, to the other newsletters in its group.
 *
 * A few small reads: this issue's groups, the other stories in them, and the
 * issues and senders those came from. A failure reads as nowhere else, since
 * the line is extra and the page must not fail over it.
 */
export async function loadElsewhere(
  client: NewsSupabaseClient,
  issueId: string,
  ownSenderId: string | null,
): Promise<Record<number, AlsoIn[]>> {
  const own = await client
    .from('story_groups')
    .select('story_index, group_id')
    .eq('issue_id', issueId);
  assertSchemaExposed(own.error, NEWS_SCHEMA);
  const ownRows = (own.data ?? []) as { story_index: number; group_id: string }[];
  if (own.error || !ownRows.length) return {};

  const others = await client
    .from('story_groups')
    .select('issue_id, group_id')
    .in(
      'group_id',
      ownRows.map((row) => row.group_id),
    )
    .neq('issue_id', issueId);
  const otherRows = (others.data ?? []) as { issue_id: string; group_id: string }[];
  if (others.error || !otherRows.length) return {};

  const issues = await client
    .from('issues')
    .select('id, sender_id, received_at')
    .in('id', [...new Set(otherRows.map((row) => row.issue_id))]);
  if (issues.error) return {};
  const found = (issues.data ?? []) as { id: string; sender_id: string; received_at: string }[];
  const senders = await client
    .from('senders')
    .select('id, name, email')
    .in('id', [...new Set(found.map((row) => row.sender_id))]);
  if (senders.error) return {};
  const names = new Map(
    ((senders.data ?? []) as { id: string; name: string | null; email: string }[]).map((row) => [
      row.id,
      senderLabel({ id: row.id, name: row.name, email: row.email, muted: false }),
    ]),
  );
  const issueRows = found.map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    receivedAt: row.received_at,
    from: names.get(row.sender_id) ?? 'Unknown sender',
  }));

  return elsewhereFrom({
    ownSenderId,
    own: ownRows.map((row) => ({ storyIndex: row.story_index, groupId: row.group_id })),
    others: otherRows.map((row) => ({ issueId: row.issue_id, groupId: row.group_id })),
    issues: issueRows,
  });
}
