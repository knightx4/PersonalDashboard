import Link from 'next/link';
import { BookOpen, History, Target } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ESTABLISHED_LABEL,
  LastChecked,
  STATE_LABEL,
  StateMark,
} from '@/components/learn/concept-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadNext } from '@/lib/learn/graph/load';
import type { NextReading, NextRecheck, NextReady } from '@/lib/learn/next/rank';
import { ReadAbout } from '../s/[id]/read-about';
import { NotNow } from './not-now';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn next' };

const LINK = 'text-ui text-ink-muted underline-offset-2 hover:text-accent hover:underline';
const SUBJECT_LINK =
  'ml-auto text-small text-ink-muted underline underline-offset-2 hover:text-ink';

/**
 * A claim to start on, or one worth asking about again.
 *
 * Both are a claim with a link into a probe session, so they are drawn once.
 * A ready row is marked with the state of the claim, since what you know about
 * it is why it is worth starting, and a re-check row is marked as a re-check --
 * every one of those is a claim you answered about, so the state mark would be
 * the same tick eight times. A ready row also says how the claim was settled
 * and when it was last asked about; on a re-check row the reason line already
 * says both.
 */
function ConceptRow({ row, timezone }: { row: NextReady | NextRecheck; timezone: string }) {
  const { concept, subjectId, subjectName } = row;

  return (
    <li className="card-pad-x row-pad flex gap-3">
      {row.kind === 'ready' ? (
        <StateMark concept={concept} className="mt-0.5" />
      ) : (
        <History className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
      )}
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
          <Link href={`/learn/s/${subjectId}`} className={SUBJECT_LINK}>
            {subjectName}
          </Link>
        </p>

        {/* The claim, because the name alone does not say what you
            would be learning. */}
        <p className="mt-0.5 text-ui text-ink">{concept.claim}</p>

        {concept.misconception && (
          <p className="mt-1 text-ui text-danger">{concept.misconception}</p>
        )}

        <p className="mt-1 text-small text-ink-muted">{row.reason}</p>

        {row.kind === 'ready' && concept.state !== 'unknown' && (
          <p className="mt-0.5 text-small text-ink-muted">
            {`${STATE_LABEL[concept.state]} — ${ESTABLISHED_LABEL[concept.established]}.`}
          </p>
        )}

        {row.kind === 'ready' && <LastChecked concept={concept} timezone={timezone} />}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* The first question is written against this claim rather
              than whichever one the session would have picked. */}
          <Link href={row.href} className={LINK}>
            {row.kind === 'ready' ? 'Probe this claim' : 'Ask about this again'}
          </Link>
          {row.kind === 'ready' && <ReadAbout concept={concept} subjectId={subjectId} anyState />}
          <NotNow row={row} />
        </div>
      </div>
    </li>
  );
}

/**
 * Something you queued about a claim and never opened.
 *
 * No state pill and no claim text: a reading is not in a state, and the claim
 * it was queued against is named in the reason line rather than quoted twice.
 */
function ReadingRow({ row }: { row: NextReading }) {
  return (
    <li className="card-pad-x row-pad flex gap-3">
      <BookOpen className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link href={row.href} className="text-body font-medium text-ink hover:text-accent">
            {row.title}
          </Link>
          <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
            Queued
          </span>
          <Link href={`/learn/s/${row.subjectId}`} className={SUBJECT_LINK}>
            {row.subjectName}
          </Link>
        </p>

        <p className="mt-1 text-small text-ink-muted">{row.reason}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href={row.href} className={LINK}>
            Open this reading
          </Link>
          <NotNow row={row} />
        </div>
      </div>
    </li>
  );
}

/**
 * What you could do next, across every subject.
 *
 * A subject page answers the same question one subject and one goal at a time.
 * This answers it once, for everything you are working on, and it is read
 * straight off the graphs and the reading queue -- nothing here calls a model,
 * so the page costs a query and can be opened for no better reason than
 * wondering.
 *
 * Three kinds of row, which is what plan #477 widened it to: a claim with
 * nothing missing underneath it, a claim you answered long enough ago to be
 * worth asking about again, and a reading you queued about a gap and left.
 * Each says in one line why it is there, because three kinds mixed into one
 * list are unreadable without it. The order is in `lib/learn/next/rank.ts`.
 *
 * The list is short on purpose. Eight rows is what a screen holds and what a
 * person can choose between.
 */
export default async function LearnNextPage() {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const [rows, settings] = await Promise.all([loadNext(supabase), loadAccountSettings(user.id)]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Learn next"
        description={
          rows.length === 0
            ? 'What you could start on, with nothing missing underneath it.'
            : 'What you could start, what is worth checking again, and what you queued and left.'
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
            {rows.map((row) =>
              row.kind === 'reading' ? (
                <ReadingRow key={row.key} row={row} />
              ) : (
                <ConceptRow key={row.key} row={row} timezone={settings.timezone} />
              ),
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}
