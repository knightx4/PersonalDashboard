import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { NO_LONGER_THERE } from '@/lib/core/refs';

/**
 * What a link to a row that has gone shows, inside the shell: a ref that
 * opens nothing (/open), and every workspace's not-found.tsx when one of its
 * pages calls notFound() (plan #1923). The way back is the workspace's first
 * page, so the person lands somewhere they can carry on from.
 */
export function NoLongerThere({
  description = 'The row this link named has been deleted, or has no page to open.',
  back = { label: 'Home', href: '/' },
}: {
  description?: string;
  back?: { label: string; href: string };
}) {
  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState title={`This is ${NO_LONGER_THERE}`} description={description} action={back} />
    </>
  );
}

/** The description a workspace's not-found.tsx gives, where the row was one of its own. */
export const DELETED_OR_MOVED = 'It has been deleted, or the link that brought you here is out of date.';
