import { Disclosure } from '@/components/ui/disclosure';

/**
 * One line of the Goals home that opens in place: Dash's work, what Dash did
 * since your last visit, Later and Other goals. It is the shared fold
 * (components/ui/disclosure.tsx), a native `<details>`, so it opens before
 * the page's script loads. The line is at least 44 pixels tall on a phone,
 * and what it holds sits flush with the page rather than indented.
 */
export function FoldLine({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  /** The line as it reads closed, such as "Dash is on 2 things". */
  title: React.ReactNode;
  /** The fact beside it that says whether opening it is worth it. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Disclosure
      title={title}
      meta={meta}
      defaultOpen={defaultOpen}
      summaryClassName="px-1 py-2 max-sm:min-h-11"
      bodyClassName="mt-1 mb-4 space-y-3"
    >
      {children}
    </Disclosure>
  );
}
