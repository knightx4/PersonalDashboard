import Link, { linkVariants } from '@/components/ui/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadGoals, loadGraph, loadSubject } from '@/lib/learn/graph/load';
import { weightReason } from '@/lib/learn/flow/interest';
import { loadTrackInterest } from '@/lib/learn/flow/interest-load';
import { SubjectPresses, subjectDescription } from './header';
import { loadSubjectLens } from './lens-held';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { SectionFold } from '@/components/ui/disclosure';
import { loadCurriculum, type StoredUnit } from '@/lib/learn/graph/curriculum-store';
import { curriculumRows, type UnitRow } from '@/lib/learn/graph/curriculum-view';
import { loadTrackPieces, type PieceSibling } from '@/lib/learn/lessons/piece-store';
import { loadPlan, planOwnerFor } from '@/lib/learn/lessons/plan-store';
import type { PlanUnit } from '@/lib/learn/lessons/plan-view';
import type { ProjectView } from '@/lib/learn/lessons/project';
import { loadProjectView } from '@/lib/learn/lessons/project-store';
import { isOwner } from '@/lib/dev/owner';
import { loadSubjectChannels, type SubjectChannels } from '@/lib/learn/youtube/subject-channels';
import { deleteSubject } from './actions';
import { loadSubjectLearning, type SubjectLearning } from '@/lib/learn/chat/subject-load';
import { ChannelsSection } from './channels';
import { ChatLearningSection } from './chat-learning';
import { CurriculumComing, WriteCurriculum } from './curriculum';
import { PlanSection } from './plan';
import { AddSource } from './add-source';
import { PreparationBlock } from './prepare';
import { DirectionOffer } from './direction';
import { directionOffer } from '@/lib/learn/prepare/branch';
import { SourcesSection, StartHere } from './sources';
import { loadPlacementPieces } from '@/lib/learn/levels/placement-store';
import { firstNotHeld } from '@/lib/learn/levels/placement';
import { loadDirection, loadPreparation, loadSubjectTerritory } from '@/lib/learn/prepare/store';
import { loadStartTopic } from '@/lib/learn/prepare/start-load';
import {
  branchPreparationView,
  offersWriteCurriculum,
  preparationSources,
  preparationView,
  unitsComeAtStep,
  withAddedSources,
} from '@/lib/learn/prepare/view';
import { loadSubjectFigureNeeds, type UnbuiltFigure } from '@/lib/learn/figures/needs-load';
import { loadAddedSources } from '@/lib/learn/prepare/add-source-run';
import type { SourceDocument } from '@/lib/learn/prepare/finish-step';
import { countStates } from '@/lib/learn/graph/model';
import { PageColumn } from '@/components/shell/page-width';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';

export const dynamic = 'force-dynamic';

/**
 * Pulling twenty Wikipedia articles into the catalogue fetches each one and
 * then embeds a few hundred sections, which runs past a default function
 * limit. Server actions invoked from this page inherit this ceiling.
 */
export const maxDuration = 300;

/**
 * One subject: its units and their pieces (plan #2307.2).
 *
 * A subject with a plan lists its units in the Plan section, each unit's
 * pieces folded open on the one holding the next piece, and a unit not yet
 * split says its pieces are written as you reach it. One without a plan lists
 * its units as a curriculum with the same line. No goal form and no section of
 * the claims graph stands here: a concept is reached from its own page.
 *
 * Below the plan, the readings related to the subject from any list and the
 * conversations logged about it (plan #1814).
 *
 * Writes from here: writing a curriculum for a track that has none; deleting
 * the track; finding YouTube channels for it and unfollowing one (the owner
 * only); and naming Wikipedia articles at the foot of the page, which stores
 * them in the shared catalogue.
 */

/** One unit of the curriculum on a subject with no plan: what it covers, and its pieces. */
function UnitSection({
  row,
  subjectId,
  pieces,
}: {
  row: UnitRow<StoredUnit>;
  subjectId: string;
  /** The unit's pieces, once they are written (plan #1140). */
  pieces: readonly PieceSibling[];
}) {
  const { unit } = row;
  const passed = pieces.filter((piece) => piece.passed).length;
  return (
    <li className="card-pad">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-body font-semibold text-ink">
          <span className="mr-1.5 text-ink-muted tabular-nums">{unit.ordinal}.</span>
          {unit.title}
        </h3>
        {pieces.length > 0 && (
          <span className="text-small text-ink-muted tabular-nums">
            {passed === pieces.length ? 'Done' : `${passed} of ${pieces.length} passed`}
          </span>
        )}
      </div>
      {unit.covers && <p className="mt-1 text-ui text-ink-muted">{unit.covers}</p>}
      {unit.outcome && (
        <p className="mt-1 text-ui text-ink">
          <span className="text-ink-muted">By the end: </span>
          {unit.outcome}
        </p>
      )}

      {/* Each piece opens on its own page, in any order (plan #1141). */}
      {pieces.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {pieces.map((piece) => (
            <li key={piece.id} className="flex items-baseline gap-2 text-ui">
              <span className="w-5 shrink-0 text-ink-muted tabular-nums">{piece.ordinal}.</span>
              <Link href={`/learn/s/${subjectId}/p/${piece.id}`} className={linkVariants()}>
                {piece.title}
              </Link>
              {piece.passed && <span className="text-small text-ink-muted">passed</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-ui text-ink-muted">Its pieces are written as you reach it.</p>
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
  searchParams: Promise<{ known?: string; shaky?: string; unmatched?: string }>;
}) {
  const { id } = await params;
  const { known, shaky, unmatched } = await searchParams;
  const seeded = seededLine(known, shaky, unmatched);

  const user = await requireUser();
  const supabase = await createLearnClient();
  const subject = await loadSubject(supabase, id);
  if (!subject) notFound();

  const [graph, goals, settings, interest, units, pieces, learning, preparation, direction, territory, lensRead, added, unbuilt] =
    await Promise.all([
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
    // Readings related to it and chats logged about it (plan #1814). Ones that
    // cannot be read leave the section out.
    loadSubjectLearning(supabase, id).catch((): SubjectLearning => ({ readings: [], sessions: [] })),
    // The subject's preparation run (plan #2276.2): null for a subject made
    // before preparation existed. One that cannot be read leaves the block out.
    loadPreparation(supabase, user.id, id).catch(() => undefined),
    // The direction offer and the branch runs (plan #2276.7). Ones that cannot
    // be read leave the offer and the branch blocks out.
    loadDirection(supabase, user.id, id).catch(() => null),
    loadSubjectTerritory(supabase, user.id, id).catch(() => null),
    // The subject's lens, for the Levels link and the header's held levels:
    // the Subjects list opens this page now rather than the lens. One that
    // cannot be read leaves the link and the line out.
    loadSubjectLens(supabase, user.id, id).catch(() => null),
    // What the person added with Add a source (plan #2307.4). Ones that
    // cannot be read leave the Sources section with the run's documents.
    loadAddedSources(supabase, user.id, id).catch((): SourceDocument[] => []),
    // Figures its lessons asked for that cannot be drawn (plan #2321.12).
    // Ones that cannot be read leave the list out of Sources.
    loadSubjectFigureNeeds(supabase, user.id, id).catch((): UnbuiltFigure[] => []),
  ]);
  const lensId = lensRead?.id ?? null;
  const held = lensRead?.held ?? null;
  // A learning goal's track opens on its plan (plan #1143). A plan that
  // cannot be read leaves the page as an ordinary track's.
  const planGoal = await planOwnerFor(supabase, user.id, id).catch(() => null);
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
  const owner = await isOwner({ user });
  const channels: SubjectChannels | null = owner
    ? await loadSubjectChannels(supabase, user.id, id).catch(() => ({ channels: [], kept: new Set<string>() }))
    : null;
  const counts = countStates(graph);
  const { rows: unitRows } = curriculumRows(units, goals, graph);
  // Where a finished preparation says to start, and what it came from (plan
  // #2276.6). The topic is read as it stands, since it is approved after the
  // run; one that cannot be read leaves the name the run recorded.
  const sources = preparation ? preparationSources(preparation) : null;
  // The Sources section lists what the person added too, finished run or not.
  const sourceList = withAddedSources(sources, added);
  const startTopic = sources?.start.topic
    ? await loadStartTopic(supabase, user.id, sources.start.topic.id).catch(() => null)
    : null;
  // The first lesson Start here opens: the first piece not passed. A subject
  // whose pieces cannot be read, or has none, keeps the practice press.
  const startPieces =
    sources
      ? await loadPlacementPieces(supabase, user.id, id).catch(() => null)
      : null;
  const startPiece = startPieces ? firstNotHeld(startPieces) : null;
  // The card stays until the first unit is done; the curriculum's Next takes over from there.
  const firstRow = unitRows[0] ?? null;
  const showStart = sources !== null && (firstRow === null || firstRow.state !== 'done');
  // Going deeper (plan #2276.7): the offer once enough answers are graded on
  // the lens, and each branch run's steps, newest last.
  const offer = direction
    ? directionOffer({
        answers: direction.answers,
        direction: direction.direction,
        territory,
        taken: new Set(direction.branches.flatMap((b) => (b.run.branch ? [b.run.branch.key] : []))),
        prepared: direction.prepared,
      })
    : null;
  const branchRuns = (direction?.branches ?? []).flatMap((b) => {
    const view = branchPreparationView(b);
    return view ? [view] : [];
  });
  const comingAt = units.length === 0 && preparation ? unitsComeAtStep(preparationView(preparation)) : null;
  return (
    <PageColumn>

      <PageHeader
        subject={await rowSubject(toRef('learn.subjects', id))}
        title={subject.name}
        description={subjectDescription(held, counts)}
        actions={
          <>
            <SubjectPresses id={id} lensId={lensId} owner={owner} />
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

      {/* The person's own words about the subject, on a quiet panel rather
          than the bare page (taste:no-bare-text, raised on plan #2276.2). */}
      {subject.note && (
        <div className={cn(cardVariants({ padding: 'dense' }), 'mb-5')}>
          <p className="border-l-2 border-accent pl-3 text-body text-ink-muted">{subject.note}</p>
        </div>
      )}

      {/* While the subject is being prepared this leads the page; once the run
          is finished it is one line (plan #2276.2). */}
      {/* Finished, it gives way to the Start here card, and its line opens
          the Sources section under the curriculum (plan #2276.6). */}
      {preparation !== undefined && !sources && (
        <PreparationBlock subjectId={id} view={preparationView(preparation)} />
      )}
      {sources && showStart && (
        <StartHere
          unit={firstRow ? { ordinal: firstRow.unit.ordinal, title: firstRow.unit.title, covers: firstRow.unit.covers } : null}
          topic={startTopic}
          draftedName={sources.start.topic?.name ?? null}
          subjectId={id}
          lesson={startPiece ? { pieceId: startPiece.id, title: startPiece.title } : null}
          lessonPending={startPieces !== null && startPieces.length === 0}
        />
      )}
      {branchRuns.map((b) => (
          <PreparationBlock key={b.key} subjectId={id} view={b.view} branch={{ key: b.key, name: b.name }} />
        ))}
      {offer && <DirectionOffer subjectId={id} offer={offer} />}

      {plan && <PlanSection subjectId={id} units={plan} project={project} goal={planGoal} />}

      {units.length === 0 ? (
        // While the run is going its write_units step writes them (plan
        // #2276.9); a run that failed before it, or a subject with none, keeps the card.
        // #2307.4: the card is offered only when the run failed before writing them.
        comingAt ? (
          <CurriculumComing {...comingAt} />
        ) : (
          offersWriteCurriculum(preparation) && <WriteCurriculum subjectId={id} />
        )
      ) : (
        // A subject with a plan lists its units and their pieces in the Plan
        // section above; one without lists the units here (plan #2307.2).
        !plan && (
          <section className="mb-6">
            <h2 className="mb-2 text-ui font-semibold text-ink-muted">Curriculum</h2>
            <ol className={cn(cardVariants(), 'divide-y divide-border')}>
              {unitRows.map((row) => (
                <UnitSection key={row.unit.id} row={row} subjectId={id} pieces={pieces.get(row.unit.id) ?? []} />
              ))}
            </ol>
          </section>
        )
      )}

      {sourceList && (
        <SourcesSection subjectId={id} sources={sourceList} readings={learning.readings} unbuilt={unbuilt} />
      )}
      {/* One press feeds the bank the preparation reads (plan #2307.4). */}
      <AddSource subjectId={id} />

      <ChatLearningSection learning={learning} timezone={settings.timezone} />

      {/* YouTube channels stay, folded away as a secondary line (plan #2307.4). */}
      {channels && (
        <SectionFold title="YouTube channels" defaultOpen={false} className="mt-6">
          <ChannelsSection subjectId={id} channels={channels.channels} kept={channels.kept} folded />
        </SectionFold>
      )}
    </PageColumn>
  );
}
