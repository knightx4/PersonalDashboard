import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGoals, loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { GoalForm } from '@/app/learn/know/goal-form';
import { ConceptList } from '@/components/learn/concept-list';
import { PullArticles } from './pull-articles';
import {
  countStates,
  learningOrder,
  pruneForGoal,
  readyNow,
  settledCount,
  type Graph,
} from '@/lib/learn/graph/model';

export const dynamic = 'force-dynamic';

/**
 * Pulling twenty Wikipedia articles into the catalogue fetches each one and
 * then embeds a few hundred sections, which runs past a default function
 * limit. Server actions invoked from this page inherit this ceiling.
 */
export const maxDuration = 300;

/**
 * One subject: its goals, and the chain still standing between you and each.
 *
 * The pruned view is the default and the whole graph is behind ?all=1, because
 * the pruned one is the useful one and the full one is what you want when you
 * suspect something is missing. It is a link rather than a control because the
 * page holds no state of its own -- the graph is the state.
 *
 * Two things here write. Naming another goal writes nothing until the chain it
 * proposes has been read and approved. Naming Wikipedia articles at the foot
 * of the page stores them in the shared catalogue and embeds them.
 *
 * Four states and three ways of establishing them, and the screen shows both.
 * "You told me you knew this" and "you answered three questions on it" are
 * different claims, and a page that rendered them identically would be
 * overstating one of them every time.
 */

function GoalSection({
  graph,
  goalName,
  conceptId,
  subjectId,
  timezone,
}: {
  graph: Graph;
  goalName: string;
  conceptId: string;
  subjectId: string;
  timezone: string;
}) {
  const kept = pruneForGoal(graph, conceptId);
  const chain = learningOrder(graph, kept);
  const next = readyNow(graph, kept)[0] ?? null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-ui font-semibold text-ink-muted">{goalName}</h2>

      {chain.length === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-6 text-center text-body text-ink-muted',
          )}
        >
          Nothing left standing between you and this one.
        </p>
      ) : (
        <>
          <p className="mb-2 text-ui text-ink-muted">
            {chain.length === 1
              ? 'One thing left, in the order it would be learned.'
              : `${chain.length} things left, in the order they would be learned. What you already know is not shown.`}
          </p>
          <ConceptList
            concepts={chain}
            nextId={next?.id ?? null}
            subjectId={subjectId}
            timezone={timezone}
          />
        </>
      )}
    </section>
  );
}

/**
 * What answering the opening questions did to this subject, shown once.
 *
 * Only after an approval that carried a sweep: the counts arrive in the URL
 * from the approval, so reloading later is a page without them rather than a
 * claim repeated out of context.
 */
function seededLine(known?: string, shaky?: string, unmatched?: string): string | null {
  const settled = Number(known ?? '');
  const wobbly = Number(shaky ?? '');
  const missed = Number(unmatched ?? '');
  if (!Number.isFinite(settled) || known === undefined) return null;

  const parts: string[] = [];
  if (settled > 0) parts.push(`${settled} you answered right ${settled === 1 ? 'starts' : 'start'} settled`);
  if (wobbly > 0) parts.push(`${wobbly} you missed ${wobbly === 1 ? 'starts' : 'start'} shaky`);
  if (parts.length === 0) parts.push('Nothing you answered matched a concept in this chain');
  if (missed > 0) {
    parts.push(`${missed} ${missed === 1 ? 'claim' : 'claims'} you were asked about did not turn up in it`);
  }

  return `From the opening questions: ${parts.join(', ')}.`;
}

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string; known?: string; shaky?: string; unmatched?: string }>;
}) {
  const { id } = await params;
  const { all, known, shaky, unmatched } = await searchParams;
  const showEverything = all === '1';
  const seeded = seededLine(known, shaky, unmatched);

  const user = await requireUser();
  const supabase = await createLearnClient();
  const subject = await loadSubject(supabase, id);
  if (!subject) notFound();

  const [graph, goals, settings] = await Promise.all([
    loadGraph(supabase, id),
    loadGoals(supabase, id),
    loadAccountSettings(user.id),
  ]);
  const counts = countStates(graph);
  const live = goals.filter((goal) => goal.status !== 'abandoned' && goal.conceptId !== null);

  return (
    <>
      <p className="mb-3">
        <Link
          href="/learn/know"
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          What you know
        </Link>
      </p>

      <PageHeader
        title={subject.name}
        description={
          counts.total === 0
            ? 'Nothing in this graph yet.'
            : `${settledCount(counts)} of ${counts.total} settled${
                counts.misconception > 0
                  ? ` · ${counts.misconception} ${counts.misconception === 1 ? 'misconception' : 'misconceptions'}`
                  : ''
              }`
        }
        actions={
          counts.total > 0 ? (
            <>
              <Link
                href={showEverything ? `/learn/s/${id}` : `/learn/s/${id}?all=1`}
                className="text-ui text-ink-muted hover:text-ink"
              >
                {showEverything ? 'Show what is left' : 'Show the whole graph'}
              </Link>
              <Link
                href={`/learn/s/${id}/probe`}
                className={buttonVariants({ variant: 'secondary' })}
              >
                Probe this
              </Link>
              {/* The flow limited to this track (plan #779), left again with
                  All tracks on the flow itself. */}
              <Link href={`/learn?track=${id}`} className={buttonVariants({ variant: 'primary' })}>
                Practice this
              </Link>
            </>
          ) : undefined
        }
      />

      {/* What the opening questions established, said once on the way in. A
          concept marked known is one this page deliberately stops showing, so
          a claim that seeded nothing has to be visible rather than silent. */}
      {seeded && <p className="mb-5 text-body text-ink-muted">{seeded}</p>}

      {subject.note && (
        <p className="mb-5 border-l-2 border-accent pl-3 text-body text-ink-muted">{subject.note}</p>
      )}

      {counts.total === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-6 text-center text-body text-ink-muted',
          )}
        >
          No concepts in this subject yet. A concept is one claim you can be right or wrong about —
          not a heading.
        </p>
      ) : showEverything ? (
        <>
          <p className="mb-2 text-ui text-ink-muted">
            Everything in this subject, prerequisites first — including what you already know.
          </p>
          <ConceptList
            concepts={learningOrder(graph, graph.concepts.map((concept) => concept.id))}
            nextId={null}
            subjectId={id}
            timezone={settings.timezone}
          />
        </>
      ) : live.length === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-6 text-center text-body text-ink-muted',
          )}
        >
          No goals in this subject yet. A goal is what you actually want to understand, and the
          chain leading to it is what gets shown here.
        </p>
      ) : (
        live.map((goal) => (
          <GoalSection
            key={goal.id}
            graph={graph}
            goalName={goal.asked}
            conceptId={goal.conceptId!}
            subjectId={id}
            timezone={settings.timezone}
          />
        ))
      )}

      {/* A second goal in a subject you already have is the cheap case: the
          generator is told what is here and proposes only what is missing. */}
      <GoalForm subjectId={subject.id} />

      <PullArticles />
    </>
  );
}
