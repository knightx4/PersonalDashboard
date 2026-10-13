'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { mapHref, parseMapParams, type MapParams } from '@/lib/learn/map/view';

/**
 * Idea Space's view state, shared by the map, its switches and the rail.
 *
 * Every switch on the page (layout, colour, names, a domain in the legend, the
 * open idea) changes what is drawn from data already on the page, so it is
 * held here and changed at once. The address follows through
 * `history.pushState` (law 5): a reload, a pasted link and the server's first
 * render all read it, the back button undoes the last switch, and no switch
 * waits on the server. Until 13
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

  // The view as last set, read by `set` so a switch pushes one history entry
  // even where React runs a state update twice.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);

  const set = useCallback((change: Partial<MapParams>) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setParams(next);
    window.history.pushState(null, '', mapHref(next));
  }, []);

  // Back and forward move through the switches pressed, so the view is read
  // back from the address they land on.
  useEffect(() => {
    const restore = () => {
      const search: Record<string, string> = {};
      new URLSearchParams(window.location.search).forEach((value, key) => {
        search[key] = value;
      });
      setParams(parseMapParams(search));
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
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
