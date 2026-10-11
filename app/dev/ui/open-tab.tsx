'use client';

import { useSearchParams } from 'next/navigation';
import { TAB_PARAM, tabFrom, type Tab } from '@/lib/tabs';

/**
 * The open tab's content, chosen from the address, for the gallery's tabbed
 * detail fixture (app/dev/ui/patterns.tsx). A gallery surface is drawn
 * without the page's search parameters, so it cannot choose on the server
 * the way a real page does with `tabFrom`; this reads the same parameter in
 * the browser instead, so pressing a tab in the gallery shows that tab.
 */
export function OpenTab({
  tabs,
  panels,
  param = TAB_PARAM,
}: {
  tabs: readonly Tab[];
  panels: Readonly<Record<string, React.ReactNode>>;
  /** The parameter, for a fixture that shares /dev/ui with another row of tabs. */
  param?: string;
}) {
  const active = tabFrom(useSearchParams().get(param), tabs);
  return <>{panels[active]}</>;
}
