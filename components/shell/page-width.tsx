import { cn } from '@/lib/cn';

/**
 * The two page widths. Every page in the shell picks one, so moving between
 * tabs moves the page only when the page's shape changes.
 *
 * PageColumn is a page that reads as one column: lists, tables, forms, a
 * detail read top to bottom. It is max-w-5xl (1024px), the width Plan's
 * six-column table needs, centred in the shell. Long text inside it keeps a
 * readable line with max-w-prose.
 *
 * PageWide is a page with a second column beside the main one, such as a
 * filter rail, a rail of what you glance at, a properties column or a list
 * beside the note, or a grid such as the calendar's seven days. It takes the
 * shell's whole box (max-w-[1400px]), since the second column would otherwise
 * take the room the main one needs.
 */
export function PageColumn({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-5xl', className)}>{children}</div>;
}

export function PageWide({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('w-full', className)}>{children}</div>;
}
