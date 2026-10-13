'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useOptimisticWrite, type WriteResult } from '@/lib/use-optimistic-write';
import { inOrder, swapSibling, type SiblingMove } from '@/lib/plan/optimistic';

/**
 * Reorder drawn before the server answers, for any list of rows with Move up
 * and Move down (plan #1851).
 *
 * The plan's rows have their own copy in app/dev/plan/sibling-order.tsx
 * (plan #1850). This one takes the write, so the goal rows and the step rows
 * share it. A row's Move up acts on the list it sits in, which the row does
 * not own: the list holds its order here, swaps it the moment the press
 * lands, and the row reaches it through context. A refused move puts the
 * order back and the reason goes to the toast (`useOptimisticWrite`).
 */

export type { SiblingMove };

type MoveSibling = (move: SiblingMove) => void;
type WriteMove = (move: SiblingMove) => Promise<WriteResult>;

const SiblingMoveContext = createContext<MoveSibling | null>(null);

/** The move of the list this row sits in, or null for a row outside one. */
export function useMoveSibling(): MoveSibling | null {
  return useContext(SiblingMoveContext);
}

/** The items in the order they are drawn in, and the move that changes it. */
export function useSiblingOrder<T extends { id: string }>(items: readonly T[], write: WriteMove) {
  const served = useMemo(() => items.map((item) => item.id), [items]);
  const { shown, run } = useOptimisticWrite<readonly string[], SiblingMove>({
    value: served,
    apply: swapSibling,
    write,
  });
  const ordered = useMemo(() => inOrder(items, shown), [items, shown]);
  const move = useCallback((change: SiblingMove) => run(change), [run]);
  return { ordered, move };
}

/**
 * A row's own Move up and Move down: the list's when it sits in one, and a
 * write of its own that waits for the server when it does not (a step drawn
 * alone on its own page).
 */
export function useMoveSelf(id: string, write: WriteMove) {
  const sibling = useMoveSibling();
  const { run: alone } = useOptimisticWrite<number, SiblingMove>({
    value: 0,
    apply: (current) => current,
    write,
  });
  return useCallback(
    (direction: SiblingMove['direction']) => (sibling ?? alone)({ id, direction }),
    [sibling, alone, id],
  );
}

export function SiblingMoveProvider({
  move,
  children,
}: {
  move: MoveSibling;
  children: ReactNode;
}) {
  return <SiblingMoveContext.Provider value={move}>{children}</SiblingMoveContext.Provider>;
}

/** A list of rows that can be reordered; the rows are drawn by `children`. */
export function OrderedSiblings<T extends { id: string }>({
  items,
  write,
  children,
}: {
  items: readonly T[];
  write: WriteMove;
  children: (ordered: readonly T[]) => ReactNode;
}) {
  const { ordered, move } = useSiblingOrder(items, write);
  return <SiblingMoveProvider move={move}>{children(ordered)}</SiblingMoveProvider>;
}
