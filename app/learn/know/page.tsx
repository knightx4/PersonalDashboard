import Link from 'next/link';
import { Network } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGraph, loadSubjects } from '@/lib/learn/graph/load';
import { outstandingCount, unfinishedSweep } from '@/lib/learn/graph/opening';
import { countStates, settledCount } from '@/lib/learn/graph/model';
import { MAX_BRIEFING_CHARS } from '@/lib/learn/graph/from-brief';
import { BriefForm } from './brief-form';
import { GoalForm } from './goal-form';
import { PriorForm } from './prior-form';

export const dynamic = 'force-dynamic';

/**
 * What you know, by subject.
 *
 * The other half of the module. The queue answers "where do I read this"; this
 * answers "what do I actually know, what am I missing, and what is the one
 * next thing worth learning".
 *
 * A subject is the container and it lives forever, so this list is short and
 * grows slowly -- one row per field you have ever worked on, not one per
 * thing you asked. Read-only for now: nothing here creates a subject, because
 * the slice this belongs to exists to prove the view over a graph put there by
 * hand before anything generates into it.
 */

function settledLine(counts: ReturnType<typeof countStates>): string {
  if (counts.total === 0) return 'No concepts yet.';

  const parts = [`${settledCount(counts)} of ${counts.total} settled`];
  if (counts.recognised > 0) parts.push(`${counts.recognised} recognised`);
  if (counts.shaky > 0) parts.push(`${counts.shaky} shaky`);
  // Named first-class, because a thing steering you wrong is not a gap and
  // should not be counted as one.
  if (counts.misconception > 0) {
    parts.push(`${counts.misconception} ${counts.misconception === 1 ? 'misconception' : 'misconceptions'}`);
  }
  return parts.join(' · ');
}

export default async function KnowPage() {
  const supabase = await createLearnClient();
  const subjects = await loadSubjects(supabase);
  const unfinished = await unfinishedSweep(supabase);

  const rows = await Promise.all(
    subjects.map(async (subject) => ({
      subject,
      counts: countStates(await loadGraph(supabase, subject.id)),
    })),
  );

  return (
    <>
      <PageHeader
        title="What you know"
        description="One graph per subject, and it grows every time you use it."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No subjects yet"
          description="A subject is the container — Economics, not the Phillips curve. Name a goal below and the chain of things leading to it gets laid out, in whichever subject it belongs to."
        />
      ) : (
        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {rows.map(({ subject, counts }) => (
            <li key={subject.id}>
              <Link
                href={`/learn/s/${subject.id}`}
                className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-sunken"
              >
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{subject.name}</span>
                  {subject.note && (
                    <span className="block truncate text-ui text-ink-muted">{subject.note}</span>
                  )}
                </span>
                <span className="shrink-0 text-ui text-ink-muted">{settledLine(counts)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* The way back into a set of opening questions somebody walked away
          from. Without it the only route back is a URL on a tab that is
          already closed. */}
      {unfinished && (
        <Link
          href={`/learn/opening/${unfinished.id}`}
          className={cn(
            cardVariants({ padding: 'standard', interactive: true }),
            'mt-6 block',
          )}
        >
          <span className="block text-body font-medium text-ink">
            Finish the questions on {unfinished.subjectName}
          </span>
          <span className="block text-ui text-ink-muted">
            {outstandingCount(unfinished)} of {unfinished.questions.length} left, then the chain for
            “{unfinished.asked}” gets laid out.
          </span>
        </Link>
      )}

      {/* Naming a goal is how a subject comes into being, so the form is here
          rather than behind a button: with no subjects yet, it is the only
          thing on the page worth doing. */}
      <GoalForm />

      {/* And the other direction. A goal says what you are missing; this says
          what you already have, which is the only thing on this page that can
          reach what you learned before any of this existed. Second because it
          is the rarer move -- written once for a field, not once a week. */}
      <h2 className="mt-8 text-body font-medium text-ink">Or start from what you already know</h2>
      <PriorForm />

      {/* And the third way in, the only one that starts from a document
          somebody else wrote. Last because it is the rarest: a prepared
          briefing arrives when you are about to be examined on something, not
          on an ordinary week. */}
      <h2 className="mt-8 text-body font-medium text-ink">Or import a briefing you were handed</h2>
      <BriefForm
        subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
        maxChars={MAX_BRIEFING_CHARS}
      />
    </>
  );
}
