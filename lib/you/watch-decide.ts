import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import type { DashChange } from '@/lib/talk/changes';
import {
  WATCH_CARD_SELECT,
  WATCH_MOVES,
  WATCH_STATUS_WORDS,
  watchCardFrom,
  watchIdOf,
  type WatchCard,
  type WatchDecision,
} from '@/lib/you/watch-card-model';

/**
 * Approving and declining a watch Dash wrote for someone on People (plan
 * #3030.1.2), and reading each thread watch as it is now for its card.
 *
 * Both run as the person, so RLS keeps them to their own watches. A decision
 * moves the watch only from the status it expects (WATCH_MOVES), so a second
 * press, or a press on a watch taken back by Undo, changes nothing and says
 * why. Once a watch is no longer proposed, the person's client cannot delete
 * it (you 0050), so the change's Undo stops working; the card says so.
 */

/** The thread's changes with the watch each set_reach_out proposed, as it is now. */
export async function withWatches(you: YouSupabaseClient, changes: DashChange[]): Promise<DashChange[]> {
  const ids = [...new Set(changes.flatMap((change) => watchIdOf(change) ?? []))];
  if (!ids.length) return changes;
  const { data, error } = await you.from('advisor_watches').select(WATCH_CARD_SELECT).in('id', ids);
  if (error) throw new Error(`Reading the thread's watches failed: ${error.message}`);
  const byId = new Map<string, WatchCard>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const card = watchCardFrom(row);
    if (card) byId.set(card.id, card);
  }
  return changes.map((change) => {
    const id = watchIdOf(change);
    const watch = id ? byId.get(id) : undefined;
    return watch ? { ...change, watch } : change;
  });
}

export type WatchDecided = { ok: true; watch: WatchCard } | { ok: false; error: string; watch: WatchCard | null };

/** Why a decision did not move a watch that is now in `status`. */
function alreadyWords(decision: WatchDecision, watch: WatchCard): string {
  const label = WATCH_STATUS_WORDS[watch.status].label.toLowerCase();
  if (decision === 'reopen') return `That watch is ${label}, so there is nothing to put back.`;
  return `That watch is already ${label}.`;
}

/**
 * Approve (proposed to active), decline (proposed to declined) or put a
 * declined watch back to proposed, stamping decided_at. Never throws.
 */
export async function decideWatch(
  you: YouSupabaseClient,
  watchId: string,
  decision: WatchDecision,
  now: string = new Date().toISOString(),
): Promise<WatchDecided> {
  const move = WATCH_MOVES[decision];
  const { data, error } = await you
    .from('advisor_watches')
    .update({ status: move.to, decided_at: decision === 'reopen' ? null : now })
    .eq('id', watchId)
    .eq('status', move.from)
    .select(WATCH_CARD_SELECT)
    .maybeSingle();
  if (error) {
    console.error('watch decision not written', error.message);
    return { ok: false, error: 'That did not go through. Try again.', watch: null };
  }
  const moved = watchCardFrom(data as Record<string, unknown> | null);
  if (moved) return { ok: true, watch: moved };

  // Nothing moved: say what it is now, or that it is gone.
  const { data: found } = await you.from('advisor_watches').select(WATCH_CARD_SELECT).eq('id', watchId).maybeSingle();
  const current = watchCardFrom(found as Record<string, unknown> | null);
  if (!current) return { ok: false, error: 'That watch was taken back, so there is nothing to decide.', watch: null };
  return { ok: false, error: alreadyWords(decision, current), watch: current };
}
