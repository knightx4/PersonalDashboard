import Link from '@/components/ui/link';
import { Archive, Layers, Plus } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { sectionSubject } from '@/lib/core/section-path';

/** A way to another list: a quiet word and its icon, lighter than the one button. */
const QUIET =
  'press inline-flex min-h-11 items-center gap-1.5 px-1 text-ui text-ink-muted hover:text-ink';

/**
 * The Subjects list's header, drawn by the page and the gallery: the one
 * action, Make a subject, which hides while its box is open, and Topics and
 * Archived as quiet links to the other two lists.
 */
export function SubjectsHeader({ making }: { making: boolean }) {
  return (
    <PageHeader
      subject={sectionSubject('/learn/know', 'Subjects')}
      title="Subjects"
      actions={
        <>
          {/* The topics map (plan #2138.4), which the claims graph is
              moving onto. A link here rather than a tab of its own, so
              Learn's nav does not grow. */}
          <Link href="/learn/topics" className={QUIET}>
            <Layers className="size-4" strokeWidth={1.75} aria-hidden />
            Topics
          </Link>
          {/* Archived subjects and their Restore press (plan #2355.2). */}
          <Link href="/learn/know/archived" className={QUIET}>
            <Archive className="size-4" strokeWidth={1.75} aria-hidden />
            Archived
          </Link>
          {!making && (
            <Link href="/learn/know?make=track" className={buttonVariants({ variant: 'primary' })}>
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              Make a subject
            </Link>
          )}
        </>
      }
    />
  );
}
