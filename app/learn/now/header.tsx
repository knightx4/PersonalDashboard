import { PageHeader } from '@/components/shell/page-header';
import { sectionSubject } from '@/lib/core/section-path';
import { NOW_HREF } from '@/lib/learn/flow/href';
import { PracticeSwitch } from './switch';

/**
 * Now's title and its switch. On a subject's Now (plan #1698) the page's back
 * link goes to the subject, as the one back link every row page has (plan
 * #1931.3). That link is what says the page is narrowed, so the subject's Now
 * has no description under the title to say it again.
 *
 * The cards written before Now led with today's piece (plan #2313.1) are a
 * page of their own, Cards, whose back link returns to Now and which has no
 * switch: practice is one press away on Now itself.
 */
export function NowHeader({
  description,
  practice,
  subject = null,
  cards = false,
}: {
  description?: string;
  practice: boolean;
  subject?: { id: string; name: string } | null;
  cards?: boolean;
}) {
  if (cards && !subject) {
    return (
      <PageHeader
        subject={sectionSubject(NOW_HREF, 'Now')}
        back={{ label: 'Now', href: NOW_HREF }}
        title="Cards"
        description={description}
      />
    );
  }
  return (
    <PageHeader
      subject={subject ? sectionSubject(NOW_HREF, 'Now') : undefined}
      back={subject ? { label: subject.name, href: `/learn/s/${subject.id}` } : undefined}
      title="Now"
      description={description}
      actions={<PracticeSwitch practice={practice} track={subject?.id ?? null} />}
    />
  );
}
