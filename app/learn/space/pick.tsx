'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { mapHref, type MapParams } from '@/lib/learn/map/view';

/**
 * Idea Space's view state, shared by the map, its switches and the rail.
 *
 * Every switch on the page (layout, colour, names, a domain in the legend, the
 * open idea) changes what is drawn from data already on the page, so it is
 * held here and changed at once. The address follows through
 * `history.replaceState` (law 5): a reload, a pasted link and the server's
 * first render all read it, but no switch waits on the server. Until 13
 * October each switch was a link, and every press asked the server to read
 * every idea and work both layouts out again, which took seconds.
 */

type Pick = {
  params: MapParams;
  selectedId: string | null;
  /** Change any part of the view; the address follows. */
  set: (change: Partial<MapParams>) => void;
  pick: (id: string | null) => void;
  /** Lets go of the domain picked out in the legend, as pressing empty ground does. */
  clearDomain: () => void;
};

const PickContext = createContext<Pick | null>(null);

export function PickProvider({
  params: initial,
  children,
}: {
  params: MapParams;
  children: React.ReactNode;
}) {
  const [params, setParams] = useState(initial);

  const set = useCallback((change: Partial<MapParams>) => {
    setParams((current) => {
      const next = { ...current, ...change };
      if (typeof window !== 'undefined') window.history.replaceState(null, '', mapHref(next));
      return next;
    });
  }, []);

  const pick = useCallback((id: string | null) => set({ idea: id }), [set]);
  const clearDomain = useCallback(() => set({ domain: null }), [set]);

  const value = useMemo(
    () => ({ params, selectedId: params.idea, set, pick, clearDomain }),
    [params, set, pick, clearDomain],
  );
  return <PickContext.Provider value={value}>{children}</PickContext.Provider>;
}

export function usePick(): Pick {
  const value = useContext(PickContext);
  if (!value) throw new Error('usePick needs a PickProvider above it');
  return value;
}

/**
 * A link's press turned into a change of view, so the page answers at once.
 * A press with a modifier key, or any button but the first, is left to the
 * browser so the link still opens in a new tab.
 */
export function viewOnClick(apply: () => void) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    apply();
  };
}

/** A link's press turned into a pick. */
export function pickOnClick(pick: (id: string | null) => void, id: string | null) {
  return viewOnClick(() => pick(id));
}

/** The line under the map that says what a tap does, while nothing is open. */
export function TapHint() {
  const { selectedId } = usePick();
  if (selectedId) return null;
  return <p>Point at or tap an idea to see its six nearest.</p>;
}
