import Link, { linkVariants } from '@/components/ui/link';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/cn';
import type { BoardReceipt } from '@/lib/you/board';

/**
 * Markdown from the minutes or a turn, in the reading rhythm of a paragraph
 * inside a card. The size, colour and edges go on the wrapper: .jobs-prose
 * inherits its colour and size, and its rules outrank a utility on the same
 * element.
 */
export function Prose({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cn('text-body text-ink [overflow-wrap:anywhere]', className)}>
      <Markdown markdown={markdown} className="jobs-prose" />
    </div>
  );
}

/** The receipts a position, a turn or the dream rests on that its text does not already link. */
export function Evidence({
  receipts,
  written,
}: {
  receipts: readonly BoardReceipt[];
  written: readonly string[];
}) {
  const linked = written.join('\n');
  const left = receipts.filter((receipt) => !linked.includes(`](${receipt.link})`));
  if (left.length === 0) return null;
  return (
    <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">
      Rests on{' '}
      {left.map((receipt, index) => (
        <span key={receipt.link}>
          {index > 0 && ', '}
          <ReceiptLink receipt={receipt} />
        </span>
      ))}
    </p>
  );
}

/** A receipt's link: in the app when it starts with a slash, in a new tab when it does not. */
export function ReceiptLink({ receipt, className }: { receipt: BoardReceipt; className?: string }) {
  return receipt.link.startsWith('/') ? (
    <Link href={receipt.link} className={cn(linkVariants(), className)}>
      {receipt.label}
    </Link>
  ) : (
    <a
      href={receipt.link}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(linkVariants(), className)}
    >
      {receipt.label}
    </a>
  );
}
