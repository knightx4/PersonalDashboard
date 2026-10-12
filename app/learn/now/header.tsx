import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { PracticeSwitch } from './switch';

/**
 * Now's title and its Practice only switch. On a subject's Now (plan #1698)
 * a link back to the subject sits above it, as the subject page's own link
 * back to Subjects does. That link is what says the page is narrowed, so the
 * subject's Now has no description under the title to say it again.
 */
export function NowHeader({
  description,
  practice,
  subject = null,
}: {
  description?: string;
  practice: boolean;
  subject?: { id: string; name: string } | null;
}) {
  return (
    <>
      {subject && (
        <p className="mb-3">
          <Link
            href={`/learn/s/${subject.id}`}
            className="press-area inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
            {subject.name}
          </Link>
        </p>
      )}
      <PageHeader
        title="Now"
        description={description}
        actions={<PracticeSwitch practice={practice} track={subject?.id ?? null} />}
      />
    </>
  );
}
