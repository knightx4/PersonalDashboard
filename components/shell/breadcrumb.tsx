import { Fragment } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/** One part of a path: what it is called and where it goes. */
export type Crumb = { label: string; href: string };

/**
 * The path from a workspace down to the page you are on (plan #1622), such
 * as Goals › Money › Pay off the cards, every part a link and the last one
 * this page. Drawn above the page's heading, through PageHeader's `crumbs`
 * or on its own where a page has no PageHeader.
 *
 * It stays one line at any width. On a phone the parts between the first
 * and the last fold into an ellipsis, so the path reads Goals › … › the
 * page; at every width a part too long for what is left is cut with an
 * ellipsis of its own rather than wrapping. The cut is on an inner span: a
 * link that clipped itself would clip its own press area (`press-area`, the
 * 44-pixel target a phone needs) along with the text.
 */
export function Breadcrumb({
  crumbs,
  className,
}: {
  crumbs: readonly Crumb[];
  className?: string;
}) {
  if (crumbs.length === 0) return null;
  const last = crumbs.length - 1;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center text-ui whitespace-nowrap text-ink-muted">
        {crumbs.map((crumb, index) => {
          const middle = index > 0 && index < last;
          return (
            <Fragment key={`${index}-${crumb.href}`}>
              <li
                className={cn(
                  'flex min-w-0 items-center',
                  // The first part is the workspace and is short; it never gives way.
                  index === 0 && 'shrink-0',
                  middle && 'max-sm:hidden',
                )}
              >
                {index > 0 && <Separator />}
                <Link
                  href={crumb.href}
                  aria-current={index === last ? 'page' : undefined}
                  className={cn(
                    'press-area inline-flex min-w-0 underline-offset-2 transition-colors duration-quick hover:text-ink hover:underline',
                    index === last && 'text-ink',
                  )}
                >
                  <span className="min-w-0 truncate">{crumb.label}</span>
                </Link>
              </li>
              {/* Where the middle parts were, on a phone. */}
              {index === 0 && last > 1 && (
                <li aria-hidden className="hidden shrink-0 items-center max-sm:flex">
                  <Separator />
                  <span>…</span>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function Separator() {
  return (
    <span aria-hidden className="shrink-0 px-1.5">
      ›
    </span>
  );
}
