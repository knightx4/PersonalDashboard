'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { keepView } from '@/lib/shell/kept-view';

/**
 * Keeps the view a list page is showing, so its tab returns to it (note
 * 978314f8, lib/shell/kept-view.ts). Drawn once on a page whose tab is marked
 * `keepsView`; it draws nothing.
 */
export function KeepView() {
  return (
    <Suspense fallback={null}>
      <KeepFromAddress />
    </Suspense>
  );
}

function KeepFromAddress() {
  const pathname = usePathname();
  const query = useSearchParams();
  const search = query?.toString() ?? '';
  useEffect(() => {
    if (pathname) keepView(pathname, search);
  }, [pathname, search]);
  return null;
}
