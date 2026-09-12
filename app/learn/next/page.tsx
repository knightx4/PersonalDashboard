import Link from 'next/link';
import { Target } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ESTABLISHED_LABEL, STATE_LABEL, StateMark } from '@/components/learn/concept-state';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadReadyToLearn } from '@/lib/learn/graph/load';
import { ReadAbout } from '../s/[id]/read-about';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn next' };

/**
 * What you could start on right now, across every subject.
 *
 * A subject page answers the same question one subject and one goal at a time.
 * This answers it once, for everything you are working on, and it is read
 * straight off the prerequisite links -- nothing here calls a model, so the
 * page costs a query and can be opened for no better reason than wondering.
 *
 * The list is short on purpose. Eight rows is what a screen holds and what a
 * person can choose between; the ones that make the cut are the ones closest
 * to a goal you named, which is what plan #298 settled.
 */
export default async function LearnNextPage() {
  const supabase = await createLearnClient();
  const rows = await loadReadyToLearn(supabase);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Learn next"
        description={
          rows.length === 0
            ? 'What you could start on, with nothing missing underneath it.'
            : 'What you could start on right now, closest to a goal first.'
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Nothing waiting"
          description="Every claim in every subject is settled. Name a goal or paste a briefing, and what is missing will show up here."
          action={{ label: 'What you know', href: '/learn/know' }}
          className="mt-6"
        />
      ) : (
        /* One surface with hairlines rather than a card each: the rows are a
           list to choose from, and eight bordered boxes would read as eight
           unrelated things. */
        <Card padding="none" className="mt-6">
          <ul className="divide-y divide-border">
            {rows.map(({ concept, subjectId, subjectName }) => (
              <li key={concept.id} className="card-pad-x row-pad flex gap-3">
                <StateMark concept={concept} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Link
                      href={`/learn/c/${concept.id}`}
                      className="text-body font-medium text-ink hover:text-accent"
                    >
                      {concept.name}
                    </Link>
                    <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
                      {STATE_LABEL[concept.state]}
                    </span>
                    <Link
                      href={`/learn/s/${subjectId}`}
                      className="ml-auto text-small text-ink-muted underline underline-offset-2 hover:text-ink"
                    >
                      {subjectName}
                    </Link>
                  </p>

                  {/* The claim, because the name alone does not say what you
                      would be learning. */}
                  <p className="mt-0.5 text-ui text-ink">{concept.claim}</p>

                  {concept.misconception && (
                    <p className="mt-1 text-ui text-danger">{concept.misconception}</p>
                  )}

                  {concept.state !== 'unknown' && (
                    <p className="mt-0.5 text-small text-ink-muted">
                      {`${STATE_LABEL[concept.state]} — ${ESTABLISHED_LABEL[concept.established]}.`}
                    </p>
                  )}

                  <div className="mt-2">
                    <ReadAbout concept={concept} subjectId={subjectId} anyState />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
