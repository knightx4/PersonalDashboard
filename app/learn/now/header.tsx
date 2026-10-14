import { PageHeader } from '@/components/shell/page-header';
import { sectionSubject } from '@/lib/core/section-path';
import { PracticeSwitch } from './switch';

/**
 * Now's title and its Practice only switch. On a subject's Now (plan #1698)
 * the page's back link goes to the subject, as the one back link every row
 * page has (plan #1931.3). That link is what says the page is narrowed, so the
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
    <PageHeader
      subject={subject ? sectionSubject('/learn/now', 'Now') : undefined}
      back={subject ? { label: subject.name, href: `/learn/s/${subject.id}` } : undefined}
      title="Now"
      description={description}
      actions={<PracticeSwitch practice={practice} track={subject?.id ?? null} />}
    />
  );
}
