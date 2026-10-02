'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { PROJECT_ANSWER_MAX, type ProjectView } from '@/lib/learn/lessons/project';
import { PracticeData } from './p/[piece]/piece-view';
import { handInPlanProject, writePlanProject, type ProjectResult } from './project-actions';
import { LinkedText } from '@/components/ui/linked-text';

/**
 * The final project at the foot of a goal's plan (plan #1146,
 * LEARN-LESSONS-SPEC "A plan ends with a final project").
 *
 * The brief is written as the plan page first opens, when the plan has none,
 * and can be handed in at any time, whatever pieces are passed. Each hand-in
 * is marked point by point, like a piece's practice, and can be revised and
 * handed in again. Passing it with every piece passed finishes the plan, which
 * the page's header then says.
 */
export function ProjectCard({
  subjectId,
  project: initialProject,
  canWrite,
  finished,
}: {
  subjectId: string;
  project: ProjectView | null;
  /** Whether the plan has units to set a project from. */
  canWrite: boolean;
  finished: boolean;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [answer, setAnswer] = useState(initialProject?.latest?.answer ?? '');
  const [figures, setFigures] = useState<Record<string, string>>(() =>
    Object.fromEntries((initialProject?.latest?.figures ?? []).map((figure) => [figure.label, figure.value])),
  );
  const [error, setError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();
  const [marking, startMarking] = useTransition();
  const started = useRef(false);

  const write = () =>
    startWriting(async () => {
      setError(null);
      const result: ProjectResult = await writePlanProject(subjectId).catch(() => ({
        error: 'Could not write the project. Check your connection.',
      }));
      if (result.project) setProject(result.project);
      else setError(result.error ?? 'Could not write the project.');
    });

  // A plan with no project yet has it written as the page opens.
  useEffect(() => {
    if (started.current || initialProject || !canWrite) return;
    started.current = true;
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const handIn = () =>
    startMarking(async () => {
      if (!project) return;
      setError(null);
      const typed = project.figures.map((figure) => ({ label: figure.label, value: figures[figure.label] ?? '' }));
      const result: ProjectResult = await handInPlanProject(subjectId, project.id, answer, typed).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.project) {
        const wasPassed = project.passed;
        setProject(result.project);
        // The plan's header says finished once the project and every piece are passed.
        if (result.project.passed && !wasPassed) router.refresh();
      } else setError(result.error ?? 'Could not mark that.');
    });

  const passed = project?.passed ?? false;
  const typedSomething = answer.trim() !== '' || Object.values(figures).some((value) => value.trim() !== '');
  const latest = project?.latest ?? null;

  return (
    <Card padding="standard" id="final-project" className="mt-4 scroll-mt-4">
      <p className="text-small font-medium text-accent">Final project</p>
      <h2 className="mt-0.5 font-display text-title tracking-tight break-words text-ink">
        {project?.title ?? 'The final project'}
      </h2>
      <p className="mt-1 text-ui text-ink-muted">
        {passed
          ? finished
            ? 'You have passed the final project and every piece. This plan is finished, and its ideas keep coming back as review questions.'
            : 'You have passed the final project. The plan is finished once every piece is passed too.'
          : 'One larger task that uses the whole plan. Hand it in whenever you like. Dash marks each part, and every part has to be right to pass.'}
      </p>

      {!project && (
        <div className="mt-3" aria-live="polite">
          {!canWrite ? (
            <p className="text-small text-ink-muted">The project is set once the plan has units.</p>
          ) : writing ? (
            <p className="text-small text-ink-muted">Dash is writing the final project…</p>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Button type="button" variant="primary" onClick={write}>
                Write the project
              </Button>
              <PaidHint action="app/learn/s/[id]/project-actions.ts#writePlanProject" what="Cost of writing the project" />
            </span>
          )}
        </div>
      )}

      {project && (
        <>
          <p className="mt-3 whitespace-pre-line text-body text-ink">
            <LinkedText text={project.task} />
          </p>
          {project.data && <PracticeData table={project.data} />}
          {project.spreadsheetNote && (
            <p className="mt-2 text-small text-ink-muted">Typed here rather than in a spreadsheet: {project.spreadsheetNote}</p>
          )}

          {latest && (
            <section className="mt-4" aria-live="polite">
              <h3 className="text-small font-semibold text-ink-muted">
                {latest.passed ? 'Marked: every part right' : 'Marked: not yet'}
              </h3>
              <ul className="mt-1 space-y-1">
                {latest.marks.map((mark, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-ui">
                    {mark.met ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-ink" strokeWidth={2} aria-label="Right" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-label="Missing" />
                    )}
                    <span className={mark.met ? 'text-ink' : 'text-ink-muted'}>{mark.note}</span>
                  </li>
                ))}
              </ul>
              {!latest.passed && (
                <p className="mt-2 text-small text-ink-muted">Fix what is missing and hand it in again.</p>
              )}
            </section>
          )}

          {!passed && (
            <div className="mt-4 space-y-3">
              {project.figures.map((figure, index) => (
                <Field
                  key={figure.label}
                  id={`project-figure-${project.id}-${index}`}
                  label={figure.unit ? `${figure.label} (${figure.unit})` : figure.label}
                >
                  <Input
                    id={`project-figure-${project.id}-${index}`}
                    maxLength={200}
                    value={figures[figure.label] ?? ''}
                    onChange={(event) => setFigures((current) => ({ ...current, [figure.label]: event.target.value }))}
                    disabled={marking}
                  />
                </Field>
              ))}
              <Field
                id={`project-working-${project.id}`}
                label={project.figures.length > 0 ? 'Your working and conclusion' : 'Your answer'}
                hint={project.figures.length > 0 ? 'How you got there, and what you conclude.' : 'Type it as lines of text.'}
              >
                <Textarea
                  id={`project-working-${project.id}`}
                  rows={8}
                  maxLength={PROJECT_ANSWER_MAX}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  disabled={marking}
                />
              </Field>
              <span className="inline-flex items-center gap-1">
                <Button type="button" variant="primary" onClick={handIn} pending={marking} disabled={!typedSomething}>
                  {marking ? 'Marking…' : 'Hand it in'}
                </Button>
                <PaidHint action="app/learn/s/[id]/project-actions.ts#handInPlanProject" what="Cost of marking what you hand in" />
              </span>
            </div>
          )}

          {passed && project.worked && (
            <details className="group mt-4">
              <summary className="press inline-flex cursor-pointer list-none items-center rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show a worked answer</span>
                <span className="hidden group-open:inline">A worked answer</span>
              </summary>
              <p className="mt-1 whitespace-pre-line text-body text-ink">
                <LinkedText text={project.worked} />
              </p>
            </details>
          )}
        </>
      )}

      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}
