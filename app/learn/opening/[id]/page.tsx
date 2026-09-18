import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadSweep, nextQuestion, outstandingCount } from '@/lib/learn/graph/opening';
import { GoalForm } from '@/app/learn/know/goal-form';
import { QuestionForm } from './question-form';

export const dynamic = 'force-dynamic';

/**
 * The questions asked before anything is laid out for you.
 *
 * They come first because of what being asked does. Trying to retrieve
 * something about a subject before you study it improves what you take from
 * studying it afterwards, even when every answer is wrong -- and what you can
 * and cannot produce cold is a better picture of where you are starting from
 * than anything this can infer.
 *
 * Everything is read back from the rows, so closing the tab costs at most the
 * answer being typed. Nothing on this page writes to the graph: no subject
 * exists yet, and the claims only become concepts if a chain gets approved.
 */

const OUTCOME_LABEL = {
  right: 'Right',
  wrong: 'Not quite',
  skipped: 'Passed',
} as const;

export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const sweep = await loadSweep(supabase, id);
  if (!sweep) notFound();

  const left = outstandingCount(sweep);
  const current = nextQuestion(sweep);
  const total = sweep.questions.length;

  if (current) {
    return (
      <>
        <PageHeader
          title={`Before we start on ${sweep.subjectName}`}
          description="Ten questions across the subject, answered from memory. Most people get most of them wrong — that is what makes this worth doing."
        />

        <QuestionForm
          sweepId={sweep.id}
          questionId={current.id}
          question={current.question}
          position={total - left + 1}
          total={total}
          left={left}
        />
      </>
    );
  }

  const right = sweep.questions.filter((q) => q.outcome === 'right').length;
  const answered = sweep.questions.filter((q) => q.outcome !== 'skipped').length;

  return (
    <>
      <PageHeader
        title={`What you already had on ${sweep.subjectName}`}
        description={
          answered === 0
            ? 'You passed on all ten, so this starts from nothing — which is a fine place to start.'
            : `${right} of ${total} right. What you missed is what the chain below aims at.`
        }
      />

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {sweep.questions.map((question) => (
          <li key={question.id} className="px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-body font-medium text-ink">{question.claimName}</span>
              <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
                {question.outcome ? OUTCOME_LABEL[question.outcome] : 'Not reached'}
              </span>
            </p>
            <p className="mt-0.5 text-ui text-ink-muted">{question.question}</p>
            {question.response && (
              <p className="mt-0.5 text-ui text-ink">You said: {question.response}</p>
            )}
            {/* The expected answer, on every row. A sweep somebody passed on
                is still worth reading afterwards, and this is the only place
                these claims are ever stated if no chain gets approved. */}
            <p className="mt-0.5 text-ui text-ink">{question.expected}</p>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-body font-medium text-ink">Now lay out what to learn</h2>
      <GoalForm goal={sweep.asked} sweepId={sweep.id} />
    </>
  );
}
