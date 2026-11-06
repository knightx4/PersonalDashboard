import { handoffState, type DashHandoffStatus } from '@/lib/talk/handoff';
import { sessionStatus, isOpenState } from '@/lib/talk/handoff-status';
import type { AskContext, AskRow, AskToolResult } from './db';

/**
 * The `session_handoffs` lookup (plan #3005.5): what the requests a bot handed
 * to a Claude Code session are doing, read from core.dash_handoffs itself so a
 * bot answering "how's it going?" says the session's real state and never a
 * guess. Every bot has it, since it is one of the lookups. It lists the
 * person's hand-offs from every thread, open ones first, each with who sent
 * it, what it is for, its state and how long it has been in it.
 */

const TABLE = 'core.dash_handoffs';
const LIMIT = 20;
const SELECT = 'id, advisor_id, request, status, error, created_at, fired_at, finished_at, last_seen_at';

type Row = {
  id: string;
  advisor_id: string | null;
  request: string;
  status: DashHandoffStatus;
  error: string | null;
  created_at: string;
  fired_at: string | null;
  finished_at: string | null;
  last_seen_at: string | null;
};

export async function sessionHandoffsLookup(ctx: AskContext): Promise<AskToolResult> {
  const core = await ctx.db('core');
  const { data, error } = await core
    .from('dash_handoffs')
    .select(SELECT)
    .eq('user_id', ctx.userId)
    .eq('kind', 'session')
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) return { ok: false, error: `Reading the hand-offs failed: ${error.message}` };
  const rows = (data ?? []) as Row[];

  const names = new Map<string, string>();
  const advisorIds = [...new Set(rows.flatMap((r) => (r.advisor_id ? [r.advisor_id] : [])))];
  if (advisorIds.length > 0) {
    const you = await ctx.db('you');
    const { data: advisors } = await you
      .from('board_advisors')
      .select('id, name')
      .eq('user_id', ctx.userId)
      .in('id', advisorIds);
    for (const a of (advisors ?? []) as { id: string; name: string }[]) names.set(a.id, a.name);
  }

  const now = ctx.now ?? Date.now();
  const statuses = rows.map((r) => ({
    row: r,
    status: sessionStatus(
      {
        id: r.id,
        sender: r.advisor_id ? (names.get(r.advisor_id) ?? 'A bot') : null,
        request: r.request,
        state: handoffState(r.status),
        error: r.error,
        createdAt: r.created_at,
        firedAt: r.fired_at,
        finishedAt: r.finished_at,
        lastSeenAt: r.last_seen_at,
      },
      now,
    ),
  }));
  // Open ones first; the sort is stable, so each group stays newest first.
  statuses.sort((a, b) => Number(isOpenState(b.status.state)) - Number(isOpenState(a.status.state)));

  const out: AskRow[] = statuses.map(({ row, status }) => ({
    table: TABLE,
    ref: row.id,
    title: `${status.sender}: ${status.purpose.slice(0, 80)}`,
    href: '/chat',
    detail: {
      sender: status.sender,
      purpose: status.purpose,
      state: status.stateWord,
      duration: status.duration,
      how_it_is_going: status.line,
      asked_at: row.created_at,
    },
  }));
  const open = statuses.filter((s) => isOpenState(s.status.state)).length;
  return {
    ok: true,
    rows: out,
    totals: { open, listed: out.length },
    note:
      out.length === 0
        ? 'No request has been handed to a Claude Code session. Say so; do not suggest one is running.'
        : `${open} still open. Say what how_it_is_going says for the one they mean; the state is read from the hand-off itself. Working means the session is going, Waiting to start means it has not begun, and Stopped means it did not finish: say so plainly and offer to hand it on again.`,
  };
}
