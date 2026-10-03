import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { LinkPending } from '@/components/ui/link-pending';

/**
 * `next/link` that shows it was pressed until its page arrives (plan #1444).
 * Import it in place of `next/link`: the props are the same, and LinkPending
 * goes in after the children so the link dims while it waits. Not marked
 * 'use client', so a server component can render it as it would `next/link`.
 */
export default function Link({ children, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink {...props}>
      {children}
      <LinkPending />
    </NextLink>
  );
}
