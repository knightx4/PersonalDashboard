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
import { weightReason } from '@/lib/learn/flow/interest';
import { loadTrackInterest } from '@/lib/learn/flow/interest-load';
import { practiceHref } from '@/lib/learn/flow/href';
import { GoalForm } from '@/app/learn/know/goal-form';
import { ConceptList } from '@/components/learn/concept-list';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { SectionFold } from '@/components/ui/disclosure';
import { loadCurriculum, type StoredUnit } from '@/lib/learn/graph/curriculum-store';
import { unitGoal } from '@/lib/learn/graph/curriculum-payload';
import { curriculumRows, type UnitRow } from '@/lib/learn/graph/curriculum-view';
import { loadTrackPieces, type PieceSibling } from '@/lib/learn/lessons/piece-store';
import { loadPlan, planGoalFor } from '@/lib/learn/lessons/plan-store';
import type { PlanUnit } from '@/lib/learn/lessons/plan-view';
import type { ProjectView } from '@/lib/learn/lessons/project';
import { loadProjectView } from '@/lib/learn/lessons/project-store';
import { isOwner } from '@/lib/dev/owner';
import { loadSubjectChannels, type SubjectChannels } from '@/lib/learn/youtube/subject-channels';
import { deleteSubject } from './actions';
import { ChannelsSection } from './channels';
import { WriteCurriculum } from './curriculum';
import { PlanSection } from './plan';
import { PullArticles } from './pull-articles';
import { PullCourse } from './pull-course';
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
 * The track's curriculum leads (LEARN-GRAPH-SPEC, "The curriculum"): a fixed
 * list of units, written once when the track was made. Each unit is opened on
 * its own, which lays out its chain of ideas as a goal filed under it, and a
 * chain is shown inside the unit it belongs to. Goals asked outside the
 * curriculum come after it.
 *
 * Writes from here: opening a unit or naming another goal, which saves nothing
 * until the chain is approved; writing a curriculum for a track that has
 * none; deleting the track; finding YouTube channels for it and unfollowing
 * one (the owner only); and naming Wikipedia articles at the foot of the
 * page, which stores them in the shared catalogue.
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

const UNIT_STATE: Record<UnitRow<StoredUnit>['state'], string> = {
  'not-opened': 'Not opened',
  'in-progress': 'In progress',
  done: 'Done',
};

/** One unit of the curriculum: what it covers, and its chain once opened. */
function UnitSection({
  row,
  graph,
  subjectId,
  timezone,
  pieces,
}: {
  row: UnitRow<StoredUnit>;
  graph: Graph;
  subjectId: string;
  timezone: string;
  /** The unit's pieces, on a learning goal's track once they are written (plan #1140). */
  pieces: readonly PieceSibling[];
}) {
  const { unit } = row;
  return (
    <li className="card-pad">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-body font-semibold text-ink">
          <span className="mr-1.5 text-ink-muted tabular-nums">{unit.ordinal}.</span>
          {unit.title}
        </h3>
        <span className="flex items-baseline gap-2 text-small">
          {row.next && (
            <span className="rounded-pill bg-accent-tint px-1.5 py-0.5 font-medium text-accent">
              Next
            </span>
          )}
          <span className="text-ink-muted">
            {row.state === 'in-progress'
              ? `${row.left} ${row.left === 1 ? 'idea' : 'ideas'} left`
              : UNIT_STATE[row.state]}
          </span>
        </span>
      </div>
      {unit.covers && <p className="mt-1 text-ui text-ink-muted">{unit.covers}</p>}
      {unit.outcome && (
        <p className="mt-1 text-ui text-ink">
          <span className="text-ink-muted">By the end: </span>
          {unit.outcome}
        </p>
      )}

      {/* Each piece opens on its own page, in any order (plan #1141). */}
      {pieces.length > 0 && (
        <ol className="mt-2 space-y-1">
          {pieces.map((piece) => (
            <li key={piece.id} className="flex items-baseline gap-2 text-ui">
              <span className="w-5 shrink-0 text-ink-muted tabular-nums">{piece.ordinal}.</span>
              <Link href={`/learn/s/${subjectId}/p/${piece.id}`} className="text-accent hover:underline">
                {piece.title}
              </Link>
              {piece.passed && <span className="text-small text-ink-muted">passed</span>}
            </li>
          ))}
        </ol>
      )}

      {row.state === 'not-opened' ? (
        // Opening a unit is the same goal form, pointed at the unit: its words
        // are filled in, and the chain it lays out is filed under the unit.
        <SectionFold title="Open this unit" defaultOpen={false} className="mt-2">
          <GoalForm subjectId={subjectId} unitId={unit.id} goal={unitGoal(unit)} bare />
        </SectionFold>
      ) : (
        <SectionFold title="The ideas in this unit" defaultOpen={row.next} className="mt-2">
          {row.goals.map((goal) => (
            <GoalSection
              key={goal.id}
              graph={graph}
              goalName={goal.asked}
              conceptId={goal.conceptId!}
              subjectId={subjectId}
              timezone={timezone}
            />
          ))}
          <SectionFold title="Go deeper in this unit" defaultOpen={false} className="mt-4">
            <GoalForm subjectId={subjectId} unitId={unit.id} bare />
          </SectionFold>
        </SectionFold>
      )}
    </li>
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
  if (settled > 0)
    parts.push(`${settled} you answered right ${settled === 1 ? 'starts' : 'start'} as known`);
  if (wobbly > 0)
    parts.push(`${wobbly} you missed ${wobbly === 1 ? 'starts' : 'start'} as getting there`);
  if (parts.length === 0) parts.push('Nothing you answered matched a concept in this chain');
  if (missed > 0) {
    parts.push(
      `${missed} ${missed === 1 ? 'idea' : 'ideas'} you were asked about did not turn up in it`,
    );
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

  const [graph, goals, settings, interest, units, pieces] = await Promise.all([
    loadGraph(supabase, id),
    loadGoals(supabase, id),
    loadAccountSettings(user.id),
    // Losing the line about how often it is asked is better than losing the page.
    loadTrackInterest(supabase).catch(() => null),
    // A curriculum that cannot be read leaves the page as it was before
    // tracks had one, with every goal listed on its own.
    loadCurriculum(supabase, id).catch(() => [] as StoredUnit[]),
    // A goal's pieces that cannot be read leave the units without their links.
    loadTrackPieces(supabase, user.id, id).catch(() => new Map<string, PieceSibling[]>()),
  ]);
  // A learning goal's track opens on its plan (plan #1143). A plan that
  // cannot be read leaves the page as an ordinary track's.
  const planGoal = await planGoalFor(supabase, user.id, id).catch(() => null);
  const [plan, project]: [PlanUnit[] | null, ProjectView | null] = planGoal
    ? await Promise.all([
        loadPlan(supabase, user.id, id).catch(() => null),
        // A project that cannot be read shows as not written yet, and opening
        // the page asks for it again, which returns the stored one.
        loadProjectView(supabase, user.id, id).catch(() => null),
      ])
    : [null, null];
  // The Channels section is the owner's alone (plan #1199): finding channels
  // spends their YouTube quota and transcript credits. Channels that cannot
  // be read leave the section showing none, with the button to find some.
  const channels: SubjectChannels | null = (await isOwner({ user }))
    ? await loadSubjectChannels(supabase, user.id, id).catch(() => ({ channels: [], kept: new Set<string>() }))
    : null;
  const counts = countStates(graph);
  const { rows: unitRows, outside } = curriculumRows(units, goals, graph);
  const live =
    units.length > 0
      ? outside
      : goals.filter((goal) => goal.status !== 'abandoned' && goal.conceptId !== null);

  return (
    <>
      <p className="mb-3">
        <Link
          href="/learn/know"
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Subjects
        </Link>
      </p>

      <PageHeader
        title={subject.name}
        description={
          counts.total === 0
            ? 'Nothing in this graph yet.'
            : `${settledCount(counts)} of ${counts.total} known${
                counts.misconception > 0 ? ` · ${counts.misconception} mixed up` : ''
              }`
        }
        actions={
          <>
            {counts.total > 0 && (
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
                  Ask me about this
                </Link>
                {/* The flow limited to this track (plan #779), left again with
                  All tracks on the flow itself. */}
                <Link
                  href={practiceHref({ track: id })}
                  className={buttonVariants({ variant: 'primary' })}
                >
                  Practice this
                </Link>
              </>
            )}
            <ConfirmStep
              action={deleteSubject}
              fields={{ subjectId: id }}
              prompt={
                counts.total === 0
                  ? 'Deletes this subject and its curriculum.'
                  : `Deletes this subject, its curriculum, its ${counts.total} ${
                      counts.total === 1 ? 'idea' : 'ideas'
                    } and everything you answered on them. Readings stay on their lists.`
              }
              confirmLabel="Yes, delete it"
              pendingLabel="Deleting…"
            >
              Delete subject
            </ConfirmStep>
          </>
        }
      />

      {/* What the opening questions established, said once on the way in. A
          concept marked known is one this page deliberately stops showing, so
          a claim that seeded nothing has to be visible rather than silent. */}
      {seeded && <p className="mb-5 text-body text-ink-muted">{seeded}</p>}

      {/* Why the mixed flow asks about this track as often as it does (plan
          #780), with the counts it came from. */}
      {interest && counts.total > 0 && (
        <p className="mb-5 text-ui text-ink-muted">
          {weightReason(interest.activity.get(id), interest.weights.get(id))}
        </p>
      )}

      {subject.note && (
        <p className="mb-5 border-l-2 border-accent pl-3 text-body text-ink-muted">
          {subject.note}
        </p>
      )}

      {plan && !showEverything && <PlanSection subjectId={id} units={plan} project={project} />}

      {units.length === 0 ? (
        <WriteCurriculum subjectId={id} />
      ) : (
        !showEverything &&
        (plan ? (
          // The plan lists the pieces; the ideas behind each unit stay a fold
          // away, with the forms that open a unit or go deeper in one.
          <SectionFold title="The ideas behind each unit" defaultOpen={false} className="mb-6">
            <ol className={cn(cardVariants(), 'divide-y divide-border')}>
              {unitRows.map((row) => (
                <UnitSection
                  key={row.unit.id}
                  row={row}
                  graph={graph}
                  subjectId={id}
                  timezone={settings.timezone}
                  pieces={[]}
                />
              ))}
            </ol>
          </SectionFold>
        ) : (
          <section className="mb-6">
            <h2 className="mb-2 text-ui font-semibold text-ink-muted">
              Curriculum · {unitRows.filter((row) => row.state === 'done').length} of{' '}
              {unitRows.length} units done
            </h2>
            <ol className={cn(cardVariants(), 'divide-y divide-border')}>
              {unitRows.map((row) => (
                <UnitSection
                  key={row.unit.id}
                  row={row}
                  graph={graph}
                  subjectId={id}
                  timezone={settings.timezone}
                  pieces={pieces.get(row.unit.id) ?? []}
                />
              ))}
            </ol>
          </section>
        ))
      )}

      {units.length > 0 && !showEverything ? (
        live.length > 0 && (
          <section className="mt-2">
            <h2 className="text-ui font-semibold text-ink-muted">Asked outside the curriculum</h2>
            {live.map((goal) => (
              <GoalSection
                key={goal.id}
                graph={graph}
                goalName={goal.asked}
                conceptId={goal.conceptId!}
                subjectId={id}
                timezone={settings.timezone}
              />
            ))}
          </section>
        )
      ) : counts.total === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-6 text-center text-body text-ink-muted',
          )}
        >
          No ideas in this subject yet. An idea is one thing you can be right or wrong about, not a
          heading.
        </p>
      ) : showEverything ? (
        <>
          <p className="mb-2 text-ui text-ink-muted">
            Everything in this subject, prerequisites first, including what you already know.
          </p>
          <ConceptList
            concepts={learningOrder(
              graph,
              graph.concepts.map((concept) => concept.id),
            )}
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
          No goals in this subject yet. A goal is what you actually want to understand, and the chain
          leading to it is what gets shown here.
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

      {channels && <ChannelsSection subjectId={id} channels={channels.channels} kept={channels.kept} />}

      <PullArticles />
      <PullCourse />
    </>
  );
}
