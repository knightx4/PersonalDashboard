import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { lastAnsweredLine } from '@/lib/learn/graph/last-answered';
import { loadReadyAndSettled, loadSubjects } from '@/lib/learn/graph/load';
import { pickOneToAsk } from '@/lib/learn/graph/pick';
import { answeredCount, lastAnsweredAt } from '@/lib/learn/graph/session';
import { loadFlowGoal, nextQuestion } from '@/lib/learn/flow/ahead';
import { firstParam, practiceHref } from '@/lib/learn/flow/href';
import { loadTrackOffer } from '@/lib/learn/flow/offer';
import { loadOfferSubjects } from '@/lib/learn/offer-setting';
import { goalsOnlyOrDefault } from '@/lib/learn/goals-only-setting';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadLearnAreaHref } from '@/lib/goals/learn-area';
import { FlowFocus, ScopeFilter } from './scope';
import { askCell } from '@/lib/learn/levels/answer-store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { CellAnswer } from '@/components/learn/cell-answer';
import { CellQuestionSkeleton } from '@/components/learn/cell-answer-view';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { LevelsFlow } from './levels';
import { FlowSession, type FlowOnly } from './session';
import { toFlowState } from './state';

/** Whether you have any topic, draft or approved: the flow asks about levels from then on. */
async function hasTopics(learn: LearnSupabaseClient): Promise<boolean> {
  const { count, error } = await learn.from('topics').select('id', { count: 'exact', head: true });
  return !error && (count ?? 0) > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Practice Flow: one question after another, until you stop or there is
 * nothing left to ask. Shown on the Now tab with its Practice only switch on
 * (plan #1486); it was a tab of its own at /learn/flow before, and that route
 * redirects to the switch with its query kept (`lib/learn/flow/href.ts`).
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
 It asks questions and offers new tracks, and nothing else: the queued
 * readings it used to offer after an answer belong to the feed.
 *
 * `?track=<subject id>` focuses the flow on one track (plan #779): every
 * question comes from that subject until you press All tracks, which is a
 * plain link back to the unfocused questions. Mixed is the default. A track that is not one of
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
 * goals and nothing else. While Goals only is on in Learn settings (plan
 * #2164.1) it is the default in place of Mixed, `?only=all` is Everything,
 * and no filter asks about a subject in the vault. `?goal=<aim id>` is a goal's Practise link on the
 * Goals page: it asks about that goal alone, with no filter shown, the way
 * `?track=` focuses a track. A goal with a track of its own goes to that
 * track's questions, and an archived or unknown goal back to the unfocused ones.
 *
 * The page around it owns the header; the line saying when you last answered
 * is drawn here, under the filter, because only this view asks.
 */
export async function PracticeFlow({
  track: trackParam,
  only,
  goal: goalParam,
  cell: cellParam,
  run,
  end,
  after,
}: {
  track?: string | string[];
  only?: string | string[];
  goal?: string | string[];
  cell?: string | string[];
  /** When the practice run began (plan #2138.6). */
  run?: string | string[];
  /** The run to sum up. */
  end?: string | string[];
  /** The question just answered; only part of the key. */
  after?: string | string[];
}) {
  // `?cell=<id>` asks an explain question about one level of a topic (plan
  // #2138.5), graded against that level and the ones around it. Without it,
  // placement and the fringe choose the level (#2138.6, ./levels.tsx).
  if (cellParam !== undefined) {
    const cellId = typeof cellParam === 'string' && UUID.test(cellParam) ? cellParam : null;
    if (!cellId) redirect(practiceHref());
    const user = await requireUser();
    const spend = collectSpend();
    const asked = await askCell(
      await createLearnClient(),
      user.id,
      cellId,
      process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY, onSpend: spend.sink } : undefined,
    );
    await recordLearnSpend(user.id, 'write-cell-case', spend.reports);
    return (
      <div className="mt-6">
        {asked.ok ? (
          <CellAnswer key={asked.asked.questionId} asked={asked.asked} nextHref={practiceHref()} />
        ) : (
          <EmptyState
            icon={Target}
            title="That level cannot be asked"
            description={asked.error}
            action={{ label: 'Practice', href: practiceHref() }}
          />
        )}
      </div>
    );
  }

  const trackId = typeof trackParam === 'string' && UUID.test(trackParam) ? trackParam : null;
  if (trackParam !== undefined && trackId === null) redirect(practiceHref());
  const goalId =
    trackId === null && typeof goalParam === 'string' && UUID.test(goalParam) ? goalParam : null;
  if (trackId === null && goalParam !== undefined && goalId === null) redirect(practiceHref());
  const user = await requireUser();
  const [supabase, vault] = await Promise.all([createLearnClient(), createVaultClient()]);
  // Goals only on Learn settings (plan #2164.1): the flow opens on Goals only,
  // and no filter asks a survey question.
  const goalsOnly = await goalsOnlyOrDefault(supabase, user.id);

  // A focused flow asks about one track or goal already, so the filter has
  // nothing to add. With no filter named, Goals only is the default while the
  // setting is on; Everything is written as `only=all` to get past it.
  const filter: FlowOnly =
    trackId !== null || goalId !== null
      ? null
      : only === 'tracks' || only === 'goals'
        ? only
        : only === undefined && goalsOnly
          ? 'goals'
          : null;
  const tracksOnly = filter === 'tracks';

  // Once you have topics, the flow asks about their levels (plan #2138.6),
  // and the claims graph is no longer asked about or written from here. A
  // goal, or Goals only, still asks the goal questions.
  if (goalId === null && filter !== 'goals' && (await hasTopics(supabase))) {
    const subjects = trackId ? await loadSubjects(supabase) : [];
    const focused = trackId ? subjects.find((subject) => subject.id === trackId) : undefined;
    if (trackId && !focused) redirect(practiceHref());
    const subject = focused ? { id: focused.id, name: focused.name } : null;
    return (
      <div>
        {subject ? <FlowFocus name={subject.name} back="All subjects" /> : <ScopeFilter filter={filter} />}
        <div className="mt-6">
          <Suspense key={`${subject?.id ?? 'all'}:${firstParam(run) ?? ''}:${firstParam(end) ?? ''}:${firstParam(after) ?? ''}`} fallback={<CellQuestionSkeleton />}>
            <LevelsFlow userId={user.id} subject={subject} only={filter} run={run} end={end} />
          </Suspense>
        </div>
      </div>
    );
  }

  const named = goalId ? await loadFlowGoal(supabase, goalId) : null;
  if (goalId && !named) redirect(practiceHref());
  if (named?.kind === 'track') redirect(practiceHref({ track: named.subjectId }));
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
  if (trackId && !focused) redirect(practiceHref());
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
  const surveys = !track && !tracksOnly && !aboutGoals && !goalsOnly;

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
            noSurvey: goalsOnly,
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
    picked.kind === 'nothing' &&
    !asking &&
    !track &&
    !aboutGoals &&
    // A theme from your notes is not one of your goals (plan #2164.1).
    !goalsOnly &&
    // Switched off on Learn settings (plan #1937.10); a failed read leaves it on.
    (await loadOfferSubjects(supabase, user.id).catch(() => true))
      ? await loadTrackOffer(supabase, vault)
      : null;

  return (
    <div>
      {!track && !goal && <ScopeFilter filter={filter} />}

      {goal && <FlowFocus name={goal.name} back="Everything" />}

      {track && <FlowFocus name={track.name} back="All subjects" />}

      {/* When the last one was, and nothing about how many days in a row: a
          run is something you can lose, and missing a day here costs nothing. */}
      {answered && <p className="mt-3 text-ui text-ink-muted">{answered}</p>}

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
                : 'Goals only asks about your learning goals that have no subject of their own. Add one to the Learn area in Goals, such as startup finance, and Dash will ask about it here.'
            }
            action={
              goal
                ? { label: 'Ask about everything', href: practiceHref({ only: 'all' }) }
                : { label: 'Your learning goals', href: await loadLearnAreaHref() }
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
            description="You have answered everything in this subject for now. The other subjects may still have questions."
            tone="finished"
            seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:learn-track`}
            action={{ label: 'All subjects', href: practiceHref({ only: 'all' }) }}
          />
        ) : picked.because === 'no-subjects' ? (
          <EmptyState
            icon={Target}
            title="Nothing to ask about yet"
            description="You have no subjects. Name one, or paste something you have read, and the ideas underneath it are what these questions get written against."
            action={{ label: 'Subjects', href: '/learn/know' }}
          />
        ) : (
          <EmptyState
            title="Nothing left to ask"
            description="Every idea in every subject is known. Name a goal or add a reading, and whatever is missing underneath it will be what gets asked about."
            tone="finished"
            seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:learn-five`}
          />
        )}
      </div>
    </div>
  );
}
