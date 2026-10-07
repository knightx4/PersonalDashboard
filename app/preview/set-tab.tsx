'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TAB_PARAM } from '@/lib/tabs';

/**
 * Opens a tab in the gallery by putting `?tab=` on the gallery's own
 * address once it has drawn, with any other parameters the surface needs. A surface is always shot at
 * `/preview?s=<id>`, and a page whose tabs read the address (the feature
 * page, plan #1664) would otherwise only ever be photographed on its first
 * tab. Draws nothing.
 */
export function SetTab({ tab, params }: { tab: string; params?: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    const url = new URL(window.location.href);
    const wanted = { [TAB_PARAM]: tab, ...params };
    if (Object.entries(wanted).every(([key, value]) => url.searchParams.get(key) === value)) return;
    for (const [key, value] of Object.entries(wanted)) url.searchParams.set(key, value);
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [tab, params, router]);
  return null;
}
