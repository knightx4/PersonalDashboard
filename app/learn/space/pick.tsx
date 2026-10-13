'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { mapHref, type MapParams } from '@/lib/learn/map/view';

/**
 * Which idea is open on Idea Space, shared by the map and the rail (plan
 * #1883).
 *
 * The address carries the open idea (law 5), but waiting for the page to
 * come back before the rail changed made a tap feel dead. So a pick shows at
 * once, on the map and in the rail, from the ideas already on the page, and
 * the address follows. Once the page comes back with the new address, the
 * address is the answer again; the back button and a pasted link work as
 * they did.
 */

type Pick = {
  selectedId: string | null;
  params: MapParams;
  pick: (id: string | null) => void;
};

const PickContext = createContext<Pick | null>(null);

export function PickProvider({
  params,
  children,
}: {
  params: MapParams;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // What was picked, and the address it was picked from: once the address
  // moves on (the page came back, or the back button), the address wins.
  const [picked, setPicked] = useState<{ id: string | null; from: string | null } | null>(null);
  const selectedId = picked && picked.from === params.idea ? picked.id : params.idea;

  const pick = useCallback(
    (id: string | null) => {
      setPicked({ id, from: params.idea });
      router.push(mapHref(params, { idea: id }), { scroll: false });
    },
    [params, router],
  );

  const value = useMemo(() => ({ selectedId, params, pick }), [selectedId, params, pick]);
  return <PickContext.Provider value={value}>{children}</PickContext.Provider>;
}

export function usePick(): Pick {
  const value = useContext(PickContext);
  if (!value) throw new Error('usePick needs a PickProvider above it');
  return value;
}

/**
 * A link's press turned into a pick, so the rail changes at once. A press
 * with a modifier key, or any button but the first, is left to the browser
 * so the link still opens in a new tab.
 */
export function pickOnClick(pick: (id: string | null) => void, id: string | null) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    pick(id);
  };
}

/** The line under the map that says what a tap does, while nothing is open. */
export function TapHint() {
  const { selectedId } = usePick();
  if (selectedId) return null;
  return <p>Tap an idea to see its six nearest.</p>;
}
