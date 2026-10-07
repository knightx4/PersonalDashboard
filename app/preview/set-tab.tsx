'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TAB_PARAM } from '@/lib/tabs';

/**
 * Opens a tab in the gallery by putting `?tab=` on the gallery's own
 * address once it has drawn. A surface is always shot at
 * `/preview?s=<id>`, and a page whose tabs read the address (the feature
 * page, plan #1664) would otherwise only ever be photographed on its first
 * tab. Draws nothing.
 */
export function SetTab({ tab }: { tab: string }) {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(TAB_PARAM) === tab) return;
    url.searchParams.set(TAB_PARAM, tab);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [tab, router]);
  return null;
}
