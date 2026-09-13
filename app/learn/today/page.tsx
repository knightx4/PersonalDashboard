import { Target } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { lastAnsweredLine } from '@/lib/learn/graph/last-answered';
import { loadReadyToLearn, loadSubjects } from '@/lib/learn/graph/load';
import { pickOneToAsk } from '@/lib/learn/graph/pick';
import { lastAnsweredAt } from '@/lib/learn/graph/session';
import { TodaySession } from './session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Five minutes' };

/**
 * Five minutes, one question, and then you are finished.
 *
 * The claim is picked across every subject, so there is nothing to choose
 * before starting. Whether there is anything to ask about is worked out here
 * rather than after pressing start, because the two ways of having nothing --
 * no subjects at all, and every claim settled -- are different situations and
 * only one of them is an achievement.
 */
export default async function FiveMinutesPage() {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const [settings, subjects, rows, answeredAt] = await Promise.all([
    loadAccountSettings(user.id),
    loadSubjects(supabase),
    loadReadyToLearn(supabase, 1),
    lastAnsweredAt(supabase),
  ]);

  const picked = pickOneToAsk(rows, subjects.length);
  // Read when the page was, and left alone afterwards. Answering does not
  // revalidate this route: re-running the pick would swap the card for an
  // empty state the moment the last ready claim was settled, and take the
  // reason somebody is still reading with it.
  const answered = lastAnsweredLine(answeredAt, new Date(), settings.timezone);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Five minutes"
        description={
          <>
            One question about the one thing you are ready for next.
            {/* When the last one was, and nothing about how many days in a
                row: a run is something you can lose, and missing a day here
                costs nothing. */}
            {answered && <span className="mt-0.5 block text-ui">{answered}</span>}
          </>
        }
      />

      <div className="mt-6">
        {picked.kind === 'ask' ? (
          <TodaySession />
        ) : picked.because === 'no-subjects' ? (
          <EmptyState
            icon={Target}
            title="Nothing to ask about yet"
            description="You have no subjects. Name one, or paste something you have read, and the claims underneath it are what these questions get written against."
            action={{ label: 'What you know', href: '/learn/know' }}
          />
        ) : (
          <EmptyState
            title="Nothing left to ask"
            description="Every claim in every subject is settled. Name a goal or add a reading, and whatever is missing underneath it will be what gets asked about."
            tone="finished"
            seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:learn-five`}
          />
        )}
      </div>
    </div>
  );
}
