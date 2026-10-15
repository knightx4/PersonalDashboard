import { MAIN_BOX } from '@/components/shell/main-box';
import { PageColumn } from '@/components/shell/page-width';
import { PageHeaderSkeleton, RowsSkeleton } from '@/components/ui/skeleton';

/**
 * Home's Inbox while it loads: the bar, the heading, then rows. Its own
 * shape, since the page draws its own shell and Home's loading is the front
 * page's.
 */
export default function Loading() {
  return (
    <div className="min-h-full">
      <div className="h-14 bg-page" />
      <main className={MAIN_BOX}>
        <PageColumn className="space-y-6">
          <PageHeaderSkeleton action={false} />
          <RowsSkeleton rows={5} />
        </PageColumn>
      </main>
    </div>
  );
}
