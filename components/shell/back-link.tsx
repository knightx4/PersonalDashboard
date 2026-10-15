'use client';

import { Suspense, type ComponentProps } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from '@/components/ui/link';
import { Breadcrumb, type Crumb } from '@/components/shell/breadcrumb';
import { FROM_PARAM, backTarget, listAddress, pathOf, withFrom } from '@/lib/core/back-from';
import { markReturn } from '@/lib/shell/pane-scroll';
import { cn } from '@/lib/cn';

/**
 * The one back link on a row page (plan #1931.3). It returns to the list the
 * row was opened from, with that list's filters, at the offset it was left
 * at; a row opened any other way goes back to its path's parent.
 *
 * The list is named by the address's `from` query, which the row links of a
 * list write (RowLink, below) and which lib/core/back-from.ts checks is a path
 * on this site. Pressing it marks the visit as a return, so the shell opens
 * the list where it was scrolled to (lib/shell/pane-scroll.ts).
 *
 * The address is read in a Suspense boundary: until it can be, the link goes
 * to the fallback, which is where it would go without a `from` anyway.
 */
export function BackLink({
  crumbs,
  fallback,
  className,
}: {
  /** The page's path, to name the list `from` points at. */
  crumbs: readonly Crumb[];
  /** Where to go with no `from`: the path's parent, or what the page names. */
  fallback: Crumb | null;
  className?: string;
}) {
  return (
    <Suspense fallback={<BackAnchor target={fallback} className={className} />}>
      <BackFromAddress crumbs={crumbs} fallback={fallback} className={className} />
    </Suspense>
  );
}

function BackFromAddress({
  crumbs,
  fallback,
  className,
}: {
  crumbs: readonly Crumb[];
  fallback: Crumb | null;
  className?: string;
}) {
  const query = useSearchParams();
  return <BackAnchor target={backTarget(query?.get(FROM_PARAM), crumbs, fallback)} className={className} />;
}

/**
 * What pressing the back link does beyond following it: marks the list as a
 * return, so the shell opens it at the offset it was left at.
 */
export function pressBack(href: string, store?: Parameters<typeof markReturn>[1]): void {
  markReturn(pathOf(href), store);
}

function BackAnchor({ target, className }: { target: Crumb | null; className?: string }) {
  if (!target) return null;
  return (
    <Link
      href={target.href}
      data-back-link
      onClick={() => pressBack(target.href)}
      className={cn(
        'press-area inline-flex min-w-0 max-w-full items-center gap-1 text-ui text-ink-muted transition-colors duration-quick hover:text-ink',
        className,
      )}
    >
      <ArrowLeft className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 truncate">{target.label}</span>
    </Link>
  );
}

/**
 * The path above a page's heading with the back link: under the path on a
 * phone, beside it from laptop width, ahead of it where the eye starts the
 * line. PageHeader draws it, and so do the few row pages that draw their
 * heading themselves.
 */
export function PathLine({
  crumbs,
  fallback,
  className,
}: {
  crumbs: readonly Crumb[];
  /** Where the back link goes with no `from`; null draws it only with one. */
  fallback: Crumb | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-start gap-1 lg:flex-row lg:items-center lg:gap-4',
        className,
      )}
    >
      <Breadcrumb crumbs={crumbs} className="self-stretch lg:flex-1" />
      <BackLink crumbs={crumbs} fallback={fallback} className="lg:order-first lg:max-w-xs lg:shrink-0 lg:border-r lg:border-border lg:pr-4" />
    </div>
  );
}

/**
 * A link from a list to one of its rows, carrying the list's address so the
 * row's back link returns to the list as it is now: filtered, searched and
 * grouped (plan #1931.3). The props are Link's.
 */
export function RowLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Suspense fallback={<Link href={href} {...props} />}>
      <RowLinkFromList href={href} {...props} />
    </Suspense>
  );
}

function RowLinkFromList({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const from = pathname ? listAddress(pathname, query?.toString() ?? '') : null;
  return <Link href={withFrom(href, from)} {...props} />;
}
