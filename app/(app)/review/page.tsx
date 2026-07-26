import { ClipboardCheck } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = { title: 'Review' };

/**
 * Everything with needs_review = true. Not optional polish: this is what keeps
 * the data trustworthy, and skipping it is how the dashboard quietly becomes
 * wrong. Nothing that fails a guardrail is ever dropped -- it lands here.
 */
export default async function ReviewPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('needs_review', true);

  return (
    <div className="min-w-0">
      <PageHeader
        title="Review"
        description="Orders we could not read with confidence. Nothing is ever discarded, so anything uncertain waits here."
      />

      {count ? (
        <p className="text-sm text-ink-muted">{count} to review. The queue arrives with build step 14.</p>
      ) : (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing needs review"
          description="When an order confirmation does not add up, or we cannot tell which order an email belongs to, it waits here for you instead of being guessed at."
        />
      )}
    </div>
  );
}
