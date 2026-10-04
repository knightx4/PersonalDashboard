import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { NO_LONGER_THERE } from '@/lib/core/refs';

/** What a ref that opens nothing shows: the row has gone, or has no page. */
export function NoLongerThere() {
  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState
        title={`This is ${NO_LONGER_THERE}`}
        description="The row this link named has been deleted, or has no page to open."
        action={{ label: 'Home', href: '/' }}
      />
    </>
  );
}
