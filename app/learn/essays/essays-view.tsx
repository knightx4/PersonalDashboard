import { PenLine } from 'lucide-react';
import { ListPage, ListRow } from '@/components/patterns/list-detail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { wordCountLabel, type EssaySummary } from '@/lib/learn/essays/model';
import { NewEssayButton } from './new-essay-button';

/** "12 Oct", or "12 Oct 2025" when it is not this year. */
function shortDate(iso: string, now: Date): string {
  const date = new Date(iso);
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/**
 * The Essays page (plan #1865), on the list-and-detail pattern: the header
 * with its one action, then one surface of rows, newest written first, then
 * the count. Each row opens the essay in the editor.
 */
export function EssaysView({ essays, now = new Date() }: { essays: EssaySummary[]; now?: Date }) {
  const header = <PageHeader title="Essays" actions={<NewEssayButton />} />;

  if (essays.length === 0) {
    // The empty state carries the one button, so the header does not repeat it.
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Essays" />
        <EmptyState
          icon={PenLine}
          title="No essays yet"
          description="Short essays, 200 to 2,000 words, on something you have been learning. You write every sentence; the page stays quiet while you do."
        >
          <NewEssayButton />
        </EmptyState>
      </div>
    );
  }

  return (
    <ListPage header={header} foot={`${essays.length} ${essays.length === 1 ? 'essay' : 'essays'}`}>
      {essays.map((essay) => (
        <ListRow
          key={essay.id}
          href={`/learn/e/${essay.id}`}
          title={essay.title}
          meta={[
            wordCountLabel(essay.words, essay.wordTarget),
            essay.publishedAt ? 'Published' : 'Draft',
            essay.question,
          ]
            .filter(Boolean)
            .join(' · ')}
          end={shortDate(essay.updatedAt, now)}
        />
      ))}
    </ListPage>
  );
}
