import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGoals, loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { GoalForm } from '@/app/learn/know/goal-form';
import { ESTABLISHED_LABEL, STATE_LABEL, StateMark } from '@/components/learn/concept-state';
import { ReadAbout } from './read-about';
import {
  countStates,
  learningOrder,
  pruneForGoal,
  readyNow,
  type Concept,
  type Graph,
} from '@/lib/learn/graph/model';

export const dynamic = 'force-dynamic';

/**
 * One subject: its goals, and the chain still standing between you and each.
 *
 * The pruned view is the default and the whole graph is behind ?all=1, because
 * the pruned one is the useful one and the full one is what you want when you
 * suspect something is missing. It is a link rather than a control because the
 * page holds no state of its own -- the graph is the state.
 *
 * The only thing here that writes is naming another goal, and that writes
 * nothing until the chain it proposes has been read and approved.
 *
 * Four states and three ways of establishing them, and the screen shows both.
 * "You told me you knew this" and "you answered three questions on it" are
 * different claims, and a page that rendered them identically would be
 * overstating one of them every time.
 */

function ConceptRow({
  concept,
  next,
  subjectId,
}: {
  concept: Concept;
  next: boolean;
  subjectId: string;
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
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
          {next && (
            <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-small text-accent">
              Start here
            </span>
          )}
        </p>

        {/* The claim, not a heading. This is the thing a question would be
            written against, and reading it is how you tell a real node from a
            chapter title that got in. */}
        <p className="mt-0.5 text-ui text-ink">{concept.claim}</p>

        {concept.misconception && (
          <p className="mt-1 text-ui text-danger">{concept.misconception}</p>
        )}

        <p className="mt-0.5 text-small text-ink-muted">
          {concept.state === 'unknown'
            ? concept.basis
            : `${STATE_LABEL[concept.state]} — ${ESTABLISHED_LABEL[concept.established]}. ${concept.basis}`}
        </p>

        <div className="mt-2">
          <ReadAbout concept={concept} subjectId={subjectId} />
        </div>
      </div>
    </li>
  );
}

function ConceptList({
  concepts,
  nextId,
  subjectId,
}: {
  concepts: Concept[];
  nextId: string | null;
  subjectId: string;
}) {
  return (
    <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
      {concepts.map((concept) => (
        <ConceptRow
          key={concept.id}
          concept={concept}
          next={concept.id === nextId}
          subjectId={subjectId}
        />
      ))}
    </ul>
  );
}

function GoalSection({
  graph,
  goalName,
  conceptId,
  subjectId,
}: {
  graph: Graph;
  goalName: string;
  conceptId: string;
  subjectId: string;
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
          <ConceptList concepts={chain} nextId={next?.id ?? null} subjectId={subjectId} />
        </>
      )}
    </section>
  );
}

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { id } = await params;
  const { all } = await searchParams;
  const showEverything = all === '1';

  const supabase = await createLearnClient();
  const subject = await loadSubject(supabase, id);
  if (!subject) notFound();

  const [graph, goals] = await Promise.all([loadGraph(supabase, id), loadGoals(supabase, id)]);
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
            : `${counts.known} of ${counts.total} settled${
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
            </>
          ) : undefined
        }
      />

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
          />
        ))
      )}

      {/* A second goal in a subject you already have is the cheap case: the
          generator is told what is here and proposes only what is missing. */}
      <GoalForm subjectId={subject.id} />
    </>
  );
}
