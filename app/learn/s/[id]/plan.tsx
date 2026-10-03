import Link from '@/components/ui/link';
import { ArrowRight, Check } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import type { ProjectView } from '@/lib/learn/lessons/project';
import {
  PIECE_STATE_WORDS,
  planFinished,
  planProgress,
  progressLine,
  type PlanPiece,
  type PlanUnit,
} from '@/lib/learn/lessons/plan-view';
import { AddUnitForm, UnitMenu } from './plan-edit';
import { ProjectCard } from './project';

/**
 * A learning goal's plan (plan #1143, LEARN-LESSONS-SPEC "The plan page"),
 * shown at the top of the goal's track page: how many pieces are passed, the
 * piece that is next, and every unit with its pieces below.
 *
 * Nothing locks. Every piece links to its page whatever comes before it, and
 * Next up is only the first piece not passed in the suggested order. A unit
 * with no pieces yet says so: the top-up lays one or two out an hour and
 * splits each into pieces (plan-layout.ts).
 *
 * Each unit can be moved, removed while none of its pieces is passed, and a
 * unit added by name at the foot (plan #1144, `plan-edit.tsx`).
 *
 * The plan ends with its final project (plan #1146, `project.tsx`), open from
 * the start. The plan is finished once the project and every piece are
 * passed, and the progress line then says so.
 */
export function PlanSection({
  subjectId,
  units,
  project,
}: {
  subjectId: string;
  units: readonly PlanUnit[];
  /** The final project, or null before its brief is written. */
  project: ProjectView | null;
}) {
  const progress = planProgress(units);
  const finished = planFinished(progress, project?.passed ?? false);
  const pieceHref = (pieceId: string) => `/learn/s/${subjectId}/p/${pieceId}`;

  return (
    <section className="mb-6" aria-labelledby="plan-heading">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="plan-heading" className="text-ui font-semibold text-ink-muted">
          Plan
        </h2>
        <span className="text-small text-ink-muted tabular-nums">{progressLine(progress, finished)}</span>
      </div>
      <Meter
        value={progress.passed}
        max={progress.total}
        label={`${progress.passed} of ${progress.total} pieces passed`}
        track="sunken"
        height="md"
        className="mb-4"
      />

      {progress.next ? (
        <div className={cn(cardVariants(), 'card-pad mb-4')}>
          <p className="text-small font-medium text-accent">Next up</p>
          <p className="mt-1 text-body font-semibold text-ink">{progress.next.title}</p>
          <p className="mt-0.5 text-ui text-ink-muted">
            Unit {progress.next.unitOrdinal}, {progress.next.unitTitle}
            {PIECE_STATE_WORDS[progress.next.state] ? ` · ${PIECE_STATE_WORDS[progress.next.state]}` : ''}
          </p>
          <Link
            href={pieceHref(progress.next.pieceId)}
            className={cn(buttonVariants({ variant: 'primary' }), 'press mt-3')}
          >
            {progress.next.state === 'open' ? 'Start it' : 'Carry on'}
            <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
          </Link>
        </div>
      ) : (
        <p className={cn(cardVariants(), 'mb-4 border-dashed px-4 py-6 text-center text-body text-ink-muted')}>
          {progress.total === 0
            ? 'Its pieces are written unit by unit, a unit or two an hour. The first will be here soon.'
            : progress.unitsWritten < progress.units
              ? 'Every piece written so far is passed. The next unit is being split into pieces.'
              : finished
                ? 'You have finished this plan: every piece and the final project are passed.'
                : 'Every piece of this plan is passed. Pass the final project below to finish it.'}
        </p>
      )}

      <ol className={cn(cardVariants(), 'divide-y divide-border')}>
        {units.map((unit, index) => (
          <PlanUnitRow
            key={unit.id}
            subjectId={subjectId}
            unit={unit}
            first={index === 0}
            last={index === units.length - 1}
            pieceHref={pieceHref}
            nextId={progress.next?.pieceId ?? null}
          />
        ))}
      </ol>
      <AddUnitForm subjectId={subjectId} />
      <ProjectCard subjectId={subjectId} project={project} canWrite={units.length > 0} finished={finished} />
    </section>
  );
}

function PlanUnitRow({
  subjectId,
  unit,
  first,
  last,
  pieceHref,
  nextId,
}: {
  subjectId: string;
  unit: PlanUnit;
  first: boolean;
  last: boolean;
  pieceHref: (pieceId: string) => string;
  nextId: string | null;
}) {
  const passed = unit.pieces.filter((piece) => piece.state === 'passed').length;
  return (
    <li className="card-pad">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-body font-semibold text-ink">
            <span className="mr-1.5 text-ink-muted tabular-nums">{unit.ordinal}.</span>
            {unit.title}
          </h3>
          <span className="text-small text-ink-muted tabular-nums">
            {unit.pieces.length === 0
              ? 'Not split yet'
              : passed === unit.pieces.length
                ? 'Done'
                : `${passed} of ${unit.pieces.length} passed`}
          </span>
        </div>
        <UnitMenu
          subjectId={subjectId}
          unit={unit}
          first={first}
          last={last}
          passed={passed}
          pieces={unit.pieces.length}
        />
      </div>
      {unit.outcome && (
        <p className="mt-1 text-ui text-ink">
          <span className="text-ink-muted">By the end: </span>
          {unit.outcome}
        </p>
      )}
      {unit.pieces.length > 0 && (
        <ol className="mt-2 space-y-1">
          {unit.pieces.map((piece) => (
            <PieceRow key={piece.id} piece={piece} href={pieceHref(piece.id)} next={piece.id === nextId} />
          ))}
        </ol>
      )}
    </li>
  );
}

function PieceRow({ piece, href, next }: { piece: PlanPiece; href: string; next: boolean }) {
  const words = PIECE_STATE_WORDS[piece.state];
  return (
    <li className="flex items-baseline gap-2 text-ui">
      <span className="w-5 shrink-0 text-ink-muted tabular-nums">{piece.ordinal}.</span>
      <Link href={href} className="min-w-0 text-accent hover:underline">
        {piece.title}
      </Link>
      {next && (
        <span className="shrink-0 rounded-pill bg-accent-tint px-1.5 py-0.5 text-small font-medium text-accent">
          Next
        </span>
      )}
      {piece.state === 'passed' ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-small text-ink-muted">
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
          {words}
        </span>
      ) : (
        words && <span className="shrink-0 text-small text-ink-muted">{words}</span>
      )}
    </li>
  );
}
