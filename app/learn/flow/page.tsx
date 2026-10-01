import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { lastAnsweredLine } from '@/lib/learn/graph/last-answered';
import { loadReadyAndSettled, loadSubjects } from '@/lib/learn/graph/load';
import { pickOneToAsk } from '@/lib/learn/graph/pick';
import { answeredCount, lastAnsweredAt } from '@/lib/learn/graph/session';
import { loadFlowGoal, nextQuestion } from '@/lib/learn/flow/ahead';
import { loadTrackOffer } from '@/lib/learn/flow/offer';
import { createVaultClient } from '@/lib/vault/auth/server';
import { FlowFocus, ScopeFilter } from './scope';
import { FlowSession, type FlowOnly } from './session';
import { toFlowState } from './state';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const metadata = { title: 'Practice Flow' };

/**
 * Practice Flow: one question after another, until you stop or there is
 * nothing left to ask.
 *
 * Each claim is picked across every subject, so there is nothing to choose
 * before starting, and the first question is on the screen when the page
 * opens. Usually it was written ahead and this only takes it off the queue;
 * when the queue is empty it is written here, and the page waits for it.
 * Whether there is anything to ask about is worked out here
 * rather than after pressing start, because the two ways of having nothing --
 * no subjects at all, and every claim settled -- are different situations and
 * only one of them is an achievement.
 *
 * Its own route, /learn/flow (plan #805). It was /learn itself from plan #773
 * until Learn now became what Learn opens on. /learn redirects to Learn now,
 * and a `?track=` link written in the meantime is sent on here. It asks questions
 * and offers new tracks, and nothing else: the queued readings it used to
 * offer after an answer belong to Learn now.
 *
 * `?track=<subject id>` focuses the flow on one track (plan #779): every
 * question comes from that subject until you press All tracks, which is a
 * plain link back to /learn/flow. Mixed is the default. A track that is not one of
 * yours, or no longer exists, is dropped rather than shown as empty.
 *
 * Mixed with no filter also asks about subjects you write about in the vault
 * and have no track for (plan #842), at the rate in `lib/learn/survey/rate.ts`.
 * It also asks about your open learning goals, one question in three while
 * you have one (plan #1385). `?only=tracks` is the Tracks only filter, which
 * leaves both out. With nothing left to ask in the tracks, the default still
 * asks a goal or survey question when there is one to write, before falling
 * back to the empty states.
 *
 * `?only=goals` is the Goals only filter (plan #1387), which asks about your
 * goals and nothing else. `?goal=<aim id>` is a goal's Practise link on the
 * Goals page: it asks about that goal alone, with no filter shown, the way
 * `?track=` focuses a track. A goal with a track of its own goes to that
 * track's flow, and an archived or unknown goal back to /learn/flow.
 */
export default async function PracticeFlowPage({
  searchParams,
}: {
  searchParams: Promise<{
    track?: string | string[];
    only?: string | string[];
    goal?: string | string[];
  }>;
}) {
  const { track: trackParam, only, goal: goalParam } = await searchParams;
  const trackId = typeof trackParam === 'string' && UUID.test(trackParam) ? trackParam : null;
  if (trackParam !== undefined && trackId === null) redirect('/learn/flow');
  const goalId =
    trackId === null && typeof goalParam === 'string' && UUID.test(goalParam) ? goalParam : null;
  if (trackId === null && goalParam !== undefined && goalId === null) redirect('/learn/flow');
  // A focused flow asks about one track or goal already, so the filter has nothing to add.
  const filter: FlowOnly =
    trackId === null && goalId === null && (only === 'tracks' || only === 'goals') ? only : null;
  const tracksOnly = filter === 'tracks';

  const user = await requireUser();
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);

  const named = goalId ? await loadFlowGoal(supabase, goalId) : null;
  if (goalId && !named) redirect('/learn/flow');
  if (named?.kind === 'track') redirect(`/learn/flow?track=${named.subjectId}`);
  const goal = named?.kind === 'goal' ? { id: named.id, name: named.name } : null;
  // Goals only, or one goal: nothing from the tracks is asked, so their pick
  // has no say in whether there is anything to ask.
  const aboutGoals = goal !== null || filter === 'goals';
  const [settings, subjects, rows, answeredAt, answeredSoFar] = await Promise.all([
    loadAccountSettings(user.id),
    loadSubjects(supabase),
    loadReadyAndSettled(supabase, 1, trackId),
    lastAnsweredAt(supabase),
    answeredCount(supabase),
  ]);

  const focused = trackId ? subjects.find((subject) => subject.id === trackId) : undefined;
  if (trackId && !focused) redirect('/learn/flow');
  const track = focused ? { id: focused.id, name: focused.name } : null;

  const picked = pickOneToAsk({
    ready: rows.ready,
    settled: rows.settled,
    subjectCount: track ? 1 : subjects.length,
    answered: answeredSoFar,
    now: new Date(),
  });
  // Read when the page was, and left alone afterwards. Answering does not
  // revalidate this route: re-running the pick would swap the card for an
  // empty state the moment the last ready claim was settled, and take the
  // reason somebody is still reading with it.
  const answered = lastAnsweredLine(answeredAt, new Date(), settings.timezone);

  // With no filter, a goal or the survey can still ask when the tracks have nothing.
  const surveys = !track && !tracksOnly && !aboutGoals;

  // Resumed rather than taken fresh, so a reload shows the question already
  // on the screen instead of spending another one.
  const first =
    picked.kind === 'nothing' && !surveys && !aboutGoals
      ? null
      : toFlowState(
          await nextQuestion(supabase, user.id, {
            resume: true,
            track: trackId,
            tracksOnly,
            goalsOnly: filter === 'goals',
            aim: goal?.id ?? null,
            vault,
          }),
        );
  const asking = aboutGoals
    ? first?.question !== undefined || first?.error !== undefined
    : picked.kind !== 'nothing' || first?.question !== undefined;

  // Nothing to ask across every track, including having no tracks at all: a
  // theme from your notes is offered as the way on (plan #778). Not when
  // focused, where the empty state points back at the other tracks instead.
  const offer =
    picked.kind === 'nothing' && !asking && !track && !aboutGoals
      ? await loadTrackOffer(supabase, vault)
      : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Practice Flow"
        description={
          <>
            Questions about what you are ready for next, for as long as you want to keep going.
            {/* When the last one was, and nothing about how many days in a
                row: a run is something you can lose, and missing a day here
                costs nothing. */}
            {answered && <span className="mt-0.5 block text-ui">{answered}</span>}
          </>
        }
      />

      {!track && !goal && <ScopeFilter filter={filter} />}

      {goal && <FlowFocus name={goal.name} back="Everything" />}

      {track && <FlowFocus name={track.name} back="All tracks" />}

      <div className="mt-6">
        {asking ? (
          // Keyed by the focus: moving between a track and all of them, or
          // into Tracks only, is a soft navigation, and without a new key the
          // action state would carry the last question across it.
          <FlowSession
            key={track?.id ?? (goal ? `goal:${goal.id}` : (filter ?? 'all'))}
            first={first ?? {}}
            track={track}
            only={filter}
            goal={goal}
          />
        ) : aboutGoals ? (
          <EmptyState
            icon={Target}
            title={goal ? `Nothing to ask about ${goal.name}` : 'Nothing to ask about your goals'}
            description={
              goal
                ? 'No question about this goal could be written just now. Try again later, or ask about everything.'
                : 'Goals only asks about the goals on your Goals page that have no track of their own. Name one there, such as startup finance, and Dash will ask about it here.'
            }
            action={
              goal
                ? { label: 'Ask about everything', href: '/learn/flow' }
                : { label: 'Goals', href: '/learn/goals' }
            }
          />
        ) : picked.kind !== 'nothing' ? null : offer ? (
          <FlowSession
            key="offer"
            first={{ nothing: picked.because, offer }}
            track={null}
            only={filter}
          />
        ) : track ? (
          <EmptyState
            title={`Nothing left to ask about ${track.name}`}
            description="You have answered everything in this track for now. The other tracks may still have questions."
            tone="finished"
            seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:learn-track`}
            action={{ label: 'All tracks', href: '/learn/flow' }}
          />
        ) : picked.because === 'no-subjects' ? (
          <EmptyState
            icon={Target}
            title="Nothing to ask about yet"
            description="You have no tracks. Name one, or paste something you have read, and the ideas underneath it are what these questions get written against."
            action={{ label: 'Tracks', href: '/learn/know' }}
          />
        ) : (
          <EmptyState
            title="Nothing left to ask"
            description="Every idea in every track is known. Name a goal or add a reading, and whatever is missing underneath it will be what gets asked about."
            tone="finished"
            seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:learn-five`}
          />
        )}
      </div>
    </div>
  );
}
