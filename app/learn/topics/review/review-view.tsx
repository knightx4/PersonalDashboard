import { CheckCheck, Network } from 'lucide-react';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionLabel } from '@/components/ui/section-heading';
import { moveCounts } from '@/lib/learn/levels/move';
import type { MoveState } from '@/lib/learn/levels/move-store';
import { MoveRunner, type RunShown } from './move-runner';
import { AssignmentRow, EdgeRow } from './review-rows';

/**
 * Moving the claims graph onto topics (docs/LEARN-LEVELS-SPEC.md, "Migration
 * from the claims graph"; plan #2138.4): the list of what needs the person.
 *
 * The list-and-detail pattern's list. The header's one action moves every
 * subject still to move; under it, while that runs, how far it has got. Then
 * one surface of rows: the subjects that failed, each with its reason; the
 * edges that run downwards inside one topic, only when there are any; and
 * the placements Dash was unsure of. Then the count.
 *
 * The page and the gallery both draw this, so it takes the state and reads
 * nothing itself.
 */
export function MoveReviewView({ state, running }: { state: MoveState; running?: RunShown }) {
  const counts = moveCounts(state.rows);
  const toMove = state.rows
    .filter((r) => r.status !== 'moved')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'waiting' ? -1 : 1))
    .map((r) => ({ id: r.subjectId, name: r.subjectName }));
  const failed = state.rows.filter((r) => r.status === 'failed');
  const edges = state.reviews.filter((r) => r.kind === 'edge');
  const placements = state.reviews.filter((r) => r.kind === 'assignment');
  const header = <MoveRunner toMove={toMove} shown={running} />;
  const total = state.rows.length;

  if (counts.moved === 0 && failed.length === 0) {
    return (
      <PageColumn>
        {header}
        {!running && (
          <EmptyState
            icon={Network}
            title={`${total} ${total === 1 ? 'subject' : 'subjects'} still on the claims graph`}
            description="Press Move and Dash places every idea of each subject on a topic and a level, drafting the topics your map does not have. What you knew comes with it, each subject becomes a lens, and anything Dash is unsure of is listed here for you."
          />
        )}
      </PageColumn>
    );
  }

  const open = failed.length + edges.length + placements.length;
  const foot = [
    `${counts.moved} of ${total} ${total === 1 ? 'subject' : 'subjects'} moved`,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    `${state.reviews.length} to answer`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageColumn>
      {header}
      {open === 0 ? (
        <EmptyState
          icon={CheckCheck}
          tone="finished"
          title="Nothing left to settle"
          description={
            counts.waiting > 0
              ? `Every subject moved so far is settled. ${counts.waiting} more ${counts.waiting === 1 ? 'is' : 'are'} still to move.`
              : 'Every subject is on your topics, and every placement and edge is settled.'
          }
          action={{ label: 'Open your topics', href: '/learn/topics' }}
        />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-border">
            {failed.length > 0 && <GroupLabel count={failed.length}>Could not move</GroupLabel>}
            {failed.map((row) => (
              <li key={row.subjectId} className="card-pad-x row-pad">
                <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">{row.subjectName}</p>
                <p className="text-small text-danger">{row.detail}</p>
              </li>
            ))}
            {edges.length > 0 && <GroupLabel count={edges.length}>Needs that run downwards</GroupLabel>}
            {edges.map((review) => (
              <EdgeRow key={review.id} review={review} />
            ))}
            {placements.length > 0 && <GroupLabel count={placements.length}>Placements Dash was unsure of</GroupLabel>}
            {placements.map((review) => (
              <AssignmentRow key={review.id} review={review} />
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-small text-ink-muted">{foot}</p>
    </PageColumn>
  );
}

function GroupLabel({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <li className="card-pad-x bg-sunken py-1.5">
      <SectionLabel as="h2" count={count}>
        {children}
      </SectionLabel>
    </li>
  );
}
