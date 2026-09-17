import Link from 'next/link';
import { Network, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { GoalForm } from '@/app/learn/know/goal-form';

/**
 * What the page offers when it has nothing to list.
 *
 * #478 settled that running dry is answered by a button rather than by the
 * page generating on its own: naming a goal in a subject you already have is
 * growth trigger 1, it costs a call only when you press it, and what comes
 * back goes through the same approval screen as every other way into the
 * graph. So the offer is the goal form itself, drawn as a row in the same
 * surface the list uses rather than as an empty box, because "nothing left"
 * here is the app having run out and not something having gone wrong.
 *
 * Two accounts reach this and they are not the same account. One has subjects
 * and has settled everything in them; the other has no subjects at all, so
 * there is nothing to extend and the goal it names will make the first one.
 */
export function NothingLeft({ subjects }: { subjects: { id: string; name: string }[] }) {
  const started = subjects.length > 0;
  const Icon = started ? Sparkles : Network;

  return (
    <Card padding="none" className="mt-6">
      <div className="card-pad-x row-pad flex gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">
            {started ? 'Nothing left to work on' : 'No subjects yet'}
          </p>

          <p className="mt-1 text-small text-ink-muted">
            {started
              ? 'Every claim is settled, none has gone long enough to be worth asking about again, and every reading you queued has been opened. Name a goal in one of your subjects and the claims leading up to it get laid out.'
              : 'This page reads the claims in your subjects, and there are none. Name what you want to understand and the claims leading up to it get laid out, in a subject it names itself.'}
          </p>

          {/* The offer is the form rather than a link to it: the thing that
              would give this page something is one goal and one press. */}
          <GoalForm subjects={started ? subjects : undefined} bare />

          {!started && (
            <p className="mt-3 text-small text-ink-muted">
              <Link
                href="/learn/know"
                className="underline underline-offset-2 hover:text-accent"
              >
                What you know
              </Link>{' '}
              also takes an account of what you already understand, or a briefing somebody handed
              you.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
