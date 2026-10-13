import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { cva } from 'class-variance-authority';
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

/**
 * The two looks of a link, for this Link or for an <a> to another site.
 *
 * `inline` is a link inside a sentence: accent, with a faint accent
 * underline that darkens on hover. `quiet` is a link that sits under a row as
 * metadata: muted ink with a hairline underline. Both are underlined at rest,
 * because a phone has no hover, and a link that only shows itself on hover
 * is invisible there. A link that is a whole row or a card needs neither.
 */
export const linkVariants = cva('underline underline-offset-2 transition-colors duration-quick', {
  variants: {
    tone: {
      inline: 'text-accent decoration-accent/40 hover:decoration-accent',
      quiet: 'text-ink-muted decoration-border-strong hover:text-ink hover:decoration-current',
    },
  },
  defaultVariants: { tone: 'inline' },
});
