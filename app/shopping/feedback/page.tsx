import { MessageSquarePlus } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { FeedbackList, type FeedbackRow } from './feedback-list';

export const metadata = { title: 'Bugs and requests' };

export default async function FeedbackPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from('feedback_items')
    .select(
      'id, kind, body, page_path, status, priority, resolution_note, commit_sha, created_at',
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows: FeedbackRow[] = (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as FeedbackRow['kind'],
    body: row.body as string,
    pagePath: (row.page_path as string | null) ?? null,
    status: row.status as FeedbackRow['status'],
    priority: (row.priority as number | null) ?? 2,
    resolutionNote: (row.resolution_note as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    createdAt: row.created_at as string,
  }));

  // Anything not finished is "outstanding" — including blocked work, which is
  // the state most easily forgotten.
  const OUTSTANDING = ['open', 'in_progress', 'blocked', 'planned'] as const;
  const isOutstanding = (row: FeedbackRow) =>
    (OUTSTANDING as readonly string[]).includes(row.status);

  // Same order the notes loop works them in: blocked first because it needs
  // the user, then bugs, then priority, then oldest.
  const RANK: Record<string, number> = { blocked: 0, in_progress: 1, open: 2, planned: 3 };
  const outstanding = rows.filter(isOutstanding).sort((a, b) => {
    const byStatus = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    if (a.kind !== b.kind) return a.kind === 'bug' ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const closed = rows.filter((row) => !isOutstanding(row));
  const blocked = outstanding.filter((row) => row.status === 'blocked');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Bugs and requests"
        description="Everything captured from the header button. Say “knock out the notes” in a session to have them worked top to bottom."
      />

      {blocked.length > 0 && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-ink">
          {blocked.length} note(s) blocked, waiting on an answer from you. They are
          listed first below with the question.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={MessageSquarePlus}
          title="Nothing captured yet"
          description="Use the message button in the header to log a bug or an idea the moment you hit it."
        />
      ) : (
        <div className="space-y-6">
          {outstanding.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">
                Outstanding{' '}
                <span className="font-normal text-ink-muted">({outstanding.length})</span>
              </h2>
              <FeedbackList rows={outstanding} />
            </section>
          )}
          {closed.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">
                Closed <span className="font-normal text-ink-muted">({closed.length})</span>
              </h2>
              <FeedbackList rows={closed} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
