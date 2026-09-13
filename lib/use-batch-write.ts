'use client';

import { useCallback, useTransition } from 'react';
import { useToast } from '@/components/ui/toast';
import { WRITE_FAILED, writeError } from '@/lib/use-optimistic-write';

/**
 * One write over many rows, with one undo for the lot.
 *
 * lib/use-optimistic-write.ts is the one-row version and the wrong shape here:
 * it draws a change locally while the server catches up, which twelve rows
 * leaving a queue at once do not need, and it raises a toast only when the
 * write is refused. A batch needs the opposite — a toast every time, because
 * twelve rows vanishing with nothing said is indistinguishable from a bug, and
 * one Undo rather than twelve.
 *
 * What makes the single undo possible is what the action hands back: the ids
 * it actually changed. The reversing action is then called once with that
 * list, so a batch where four of six rows were already confirmed puts back
 * exactly the two it moved.
 */

/**
 * What a bulk action returns.
 *
 * `changed` is the rows it moved, not the rows it was asked about: an action
 * that skips a row somebody else already dealt with leaves it out, and the
 * toast counts what happened rather than what was requested.
 */
export type BatchResult = {
  changed: readonly string[];
  /** Why the rest did not change. Shown when nothing did. */
  error?: string | null;
};

/** What a toast says about a batch. */
export type BatchTally = {
  /** The verb in the past tense, as the toast says it: "Confirmed". */
  verb: string;
  /** How many rows the action was asked about. */
  asked: number;
  /** How many it changed. */
  changed: number;
  /** The singular noun for one row: "order". */
  one: string;
  /** The plural, when it is not the singular plus an s. */
  many?: string;
  /** What the action said about the rows it refused. */
  error?: string | null;
};

/** "1 order", "4 orders". What a bar's verbs and its toast both count in. */
export function countNoun(count: number, one: string, many?: string): string {
  return `${count} ${count === 1 ? one : (many ?? `${one}s`)}`;
}

/**
 * The sentence the toast says once the batch is through.
 *
 * A run that moved fewer rows than it was asked about says both numbers. The
 * alternative is "Confirmed 4 orders" over a queue that still has two of them
 * in it, which teaches the person to distrust the toast.
 */
export function batchMessage(tally: BatchTally): string {
  const { verb, asked, changed, one, many, error } = tally;
  if (changed === 0) return error?.trim() ? error : 'Nothing changed.';
  if (changed < asked) return `${verb} ${changed} of ${countNoun(asked, one, many)}.`;
  return `${verb} ${countNoun(changed, one, many)}.`;
}

/** What the toast says after the undo has run. */
export function undoneMessage(tally: BatchTally): string {
  return `${countNoun(tally.changed, tally.one, tally.many)} put back.`;
}

/** A batch result from an action that returned something looser. */
export function batchResult(result: unknown, ids: readonly string[]): BatchResult {
  const error = writeError(result);
  if (!result || typeof result !== 'object') return { changed: error ? [] : [...ids], error };

  const { changed } = result as { changed?: unknown };
  if (Array.isArray(changed)) {
    return { changed: changed.filter((id): id is string => typeof id === 'string'), error };
  }
  // An action that says nothing about which rows it moved is taken at its
  // word: it either did all of them or refused the lot.
  return { changed: error ? [] : [...ids], error };
}

export function useBatchWrite(): {
  run: (batch: {
    /** The rows to act on, in list order. */
    ids: readonly string[];
    /** The verb in the past tense: "Confirmed". */
    verb: string;
    /** The singular noun for one row: "order". */
    one: string;
    many?: string;
    write: (ids: readonly string[]) => Promise<unknown>;
    /** Puts back exactly the rows the write changed. */
    undo?: (changed: readonly string[]) => Promise<unknown>;
    /** Run once the write is through, refused or not: clearing the selection. */
    onSettled?: () => void;
  }) => void;
  pending: boolean;
} {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const run = useCallback(
    ({
      ids,
      verb,
      one,
      many,
      write,
      undo,
      onSettled,
    }: {
      ids: readonly string[];
      verb: string;
      one: string;
      many?: string;
      write: (ids: readonly string[]) => Promise<unknown>;
      undo?: (changed: readonly string[]) => Promise<unknown>;
      onSettled?: () => void;
    }) => {
      if (ids.length === 0) return;

      startTransition(async () => {
        let result: BatchResult;
        try {
          result = batchResult(await write(ids), ids);
        } catch {
          // A dropped connection arrives as a rejection, not as an error the
          // action returned.
          result = { changed: [], error: WRITE_FAILED };
        }

        const tally: BatchTally = {
          verb,
          asked: ids.length,
          changed: result.changed.length,
          one,
          many,
          error: result.error,
        };
        const changed = result.changed;

        toast({
          text: batchMessage(tally),
          undone: undoneMessage(tally),
          undo:
            undo && changed.length > 0
              ? async () => {
                  await undo(changed);
                }
              : undefined,
        });
        onSettled?.();
      });
    },
    [toast],
  );

  return { run, pending };
}
