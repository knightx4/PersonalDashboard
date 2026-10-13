'use client';

import { useSearchParams } from 'next/navigation';
import { TAB_PARAM, tabFrom, type Tab, type TabAddress } from '@/lib/tabs';

/** Every tab's content, by tab id. A tab with nothing under it may be left out. */
export type TabPanelSet = Readonly<Partial<Record<string, React.ReactNode>>>;

/**
 * The open tab's content, picked in the browser from every tab's content the
 * page drew at once. With the row of tabs set `shallow`, a press writes the
 * address and this swaps the panel straight away, with no trip to the server.
 * The page only pays for this once, when it first loads.
 *
 * It reads the tab with the same `tabFrom` the row does, so the two agree.
 */
export function TabPanels({
  tabs,
  address,
  panels,
}: {
  tabs: readonly Tab[];
  address?: TabAddress;
  panels: TabPanelSet;
}) {
  const search = useSearchParams();
  const param = address?.param ?? TAB_PARAM;
  const open = tabFrom(search.get(param), tabs, address);
  return <>{panels[open] ?? null}</>;
}
