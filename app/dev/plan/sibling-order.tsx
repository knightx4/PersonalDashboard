'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { inOrder, swapSibling, type SiblingMove } from '@/lib/plan/optimistic';
import { movePlanItem } from './actions';

/**
 * Reorder, drawn before the server answers.
 *
 * A row's Move up and Move down act on the list it sits in, which the row does
 * not own. The list holds its order here, swaps it the moment the press lands,
 * and the row reaches it through context. A refused move puts the order back
 * and the reason goes to the toast (`useOptimisticWrite`).
 */

type MoveSibling = (move: SiblingMove) => void;

const SiblingMoveContext = createContext<MoveSibling | null>(null);

/** The move of the list this row sits in, or null for a row outside one. */
export function useMoveSibling(): MoveSibling | null {
  return useContext(SiblingMoveContext);
}

async function writeMove(move: SiblingMove) {
  const formData = new FormData();
  formData.set('id', move.id);
  formData.set('direction', move.direction);
  return movePlanItem({}, formData);
}

/** The items in the order they are drawn in, and the move that changes it. */
export function useSiblingOrder<T extends { id: string }>(items: readonly T[]) {
  const served = useMemo(() => items.map((item) => item.id), [items]);
  const { shown, run } = useOptimisticWrite<readonly string[], SiblingMove>({
    value: served,
    apply: swapSibling,
    write: writeMove,
  });
  const ordered = useMemo(() => inOrder(items, shown), [items, shown]);
  const move = useCallback((change: SiblingMove) => run(change), [run]);
  return { ordered, move };
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
  children,
}: {
  items: readonly T[];
  children: (ordered: readonly T[]) => ReactNode;
}) {
  const { ordered, move } = useSiblingOrder(items);
  return <SiblingMoveProvider move={move}>{children(ordered)}</SiblingMoveProvider>;
}
