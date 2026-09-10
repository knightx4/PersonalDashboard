'use client';

import { useCallback, useState, useOptimistic, useTransition } from 'react';
import { useToast } from '@/components/ui/toast';

/**
 * The optimistic tier, once.
 *
 * /dev/ui puts three tiers on every write, and the optimistic one is the tier
 * with two halves: draw the change now, and put it back if the server refuses
 * it. Three surfaces had written the first half by hand and only one of them
 * had written the second, so this is both halves in one place.
 *
 * How it reverts: `useOptimistic` holds the change only while the transition
 * that made it is running. A write that worked revalidates and the server sends
 * the new value back; a write that failed sends nothing, so the value the
 * server rendered is what is left on screen. Nothing has to undo anything.
 *
 * Where the reason goes: both places, per the decision on #170. The control
 * marks itself with `failed`, because that is where the person is looking, and
 * the sentence goes in the toast, because an 18px checkbox has nowhere to put
 * one.
 */

/**
 * What a write hands back.
 *
 * Wider than the `{ error: string | null }` most actions in this app return, so
 * a form-state action and one that returns nothing at all can both be driven
 * through the hook without a wrapper at the call site.
 */
export type WriteResult = { error?: string | null } | void;

/** Shown when a write throws rather than returning. */
export const WRITE_FAILED = 'That did not save. Try again.';

/**
 * The reason a write failed, or null when it worked.
 *
 * Pure, and the one part of this file a node test can reach: the hook itself is
 * only checkable through a surface that uses it.
 */
export function writeError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;

  const { error } = result as { error?: unknown };
  if (typeof error !== 'string') return null;

  return error.trim() ? error : null;
}

export function useOptimisticWrite<Value, Change>({
  value,
  apply,
  write,
  onDone,
}: {
  /** What the server rendered. What the control falls back to. */
  value: Value;
  /** The same change, drawn locally. Pure: it is run again on every render. */
  apply: (current: Value, change: Change) => Value;
  write: (change: Change) => Promise<WriteResult>;
  /**
   * Run once the write is through, and never when it is refused.
   *
   * What an undo toast hangs off: offering the way back from something that
   * did not happen is worse than offering nothing.
   */
  onDone?: (change: Change) => void;
}): {
  /** What to draw: the change if one is in flight, the server's value if not. */
  shown: Value;
  run: (change: Change) => void;
  pending: boolean;
  /** Whether the last write was refused. Cleared by the next attempt. */
  failed: boolean;
} {
  const [shown, addChange] = useOptimistic(value, apply);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const toast = useToast();

  const run = useCallback(
    (change: Change) => {
      setFailed(false);
      startTransition(async () => {
        addChange(change);

        // A server action rejects on a dropped connection and on anything it
        // throws, and neither arrives as a returned error.
        let message: string | null;
        try {
          message = writeError(await write(change));
        } catch {
          message = WRITE_FAILED;
        }

        if (!message) {
          onDone?.(change);
          return;
        }

        setFailed(true);
        toast({ text: message });
      });
    },
    [addChange, write, onDone, toast],
  );

  return { shown, run, pending, failed };
}
