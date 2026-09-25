'use client';

import { useEffect, useRef } from 'react';
import type { TreeActionState } from './types';

/**
 * Closes a form once its action has landed.
 *
 * Compared by identity rather than by the text of the message, so two
 * consecutive saves are distinguishable. In an effect rather than during
 * render, because what closes is usually the parent's state -- "stop editing",
 * "stop adding" -- and a child may not set its parent's state while rendering.
 */
export function useSettled(state: TreeActionState, onSettle: () => void) {
  const seen = useRef<TreeActionState | null>(null);
  useEffect(() => {
    if (state.message && state !== seen.current) {
      seen.current = state;
      onSettle();
    }
  }, [state, onSettle]);
}
