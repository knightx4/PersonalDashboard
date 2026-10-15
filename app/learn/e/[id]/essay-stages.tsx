'use client';

import { useCallback, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import {
  nextStage,
  STAGE_AIMS,
  STAGE_LABELS,
  STAGES,
  type EssayPlan,
  type Stage,
} from '@/lib/learn/essays/plan';
import type { EssayBrief } from '@/lib/learn/essays/model';
import { changeEssayPlan, type PlanChange, type PlanResult } from './guide-actions';

/**
 * The plan behind the guided stages (LEARN-ESSAYS-SPEC, "The stages"). A
 * change the person makes shows at once and is sent to the server, whose
 * answer replaces it; a press that asks Dash for something waits for the
 * answer. `frozen` is for the gallery, which draws a state and never calls
 * the server.
 */
export function useEssayPlan(essayId: string, initial: EssayPlan, frozen = false) {
  const [plan, setPlan] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  // One write at a time: each reads the stored plan and writes it back, so two
  // at once would lose whichever finished first.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const take = useCallback((result: PlanResult | undefined) => {
    if (!result) {
      setError('The connection dropped. Try again in a moment.');
      return false;
    }
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setError(null);
    setPlan(result.plan);
    return true;
  }, []);

  /** One of the person's own changes, kept straight away and saved behind. */
  const change = useCallback(
    (next: PlanChange, optimistic?: (plan: EssayPlan) => EssayPlan) => {
      if (optimistic) setPlan((now) => optimistic(now));
      if (frozen) return;
      const ticket = ++latest.current;
      queue.current = queue.current.then(async () => {
        const result = await changeEssayPlan(essayId, next).catch(() => undefined);
        // An older answer arriving after a newer change would undo it on screen.
        if (ticket === latest.current) take(result);
        else if (!result || !result.ok) setError(result ? result.error : 'The connection dropped.');
      });
    },
    [essayId, frozen, take],
  );

  /** A press that asks Dash for something and waits for the plan it leaves. */
  const run = useCallback(
    async (call: () => Promise<PlanResult>) => {
      if (frozen) return false;
      const ticket = ++latest.current;
      const done = queue.current.then(() => call().catch(() => undefined));
      queue.current = done;
      const result = await done;
      if (ticket !== latest.current && result?.ok) return true;
      return take(result);
    },
    [frozen, take],
  );

  return { plan, setPlan, change, run, error, setError };
}

export type PlanApi = ReturnType<typeof useEssayPlan>;

/**
 * The six stages across the top of the essay. Each is a button: the person
 * can go to any stage at any time, and a tick marks the ones with enough in
 * them to move on from. Nothing is locked.
 */
export function StageStepper({
  stage,
  done,
  onStage,
  className,
}: {
  stage: Stage;
  done: Record<Stage, boolean>;
  onStage: (stage: Stage) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Essay stages" className={cn('mb-5', className)}>
      <ol className="flex flex-wrap gap-1">
        {STAGES.map((s, i) => {
          const on = s === stage;
          return (
            <li key={s}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                pressed={on}
                aria-current={on ? 'step' : undefined}
                onClick={() => onStage(s)}
                className="gap-1.5"
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-4 items-center justify-center rounded-full text-micro tabular-nums',
                    done[s] ? 'bg-positive-tint text-positive' : 'bg-sunken text-ink-muted',
                  )}
                >
                  {done[s] ? <Check className="size-3" strokeWidth={1.75} /> : i + 1}
                </span>
                {STAGE_LABELS[s]}
                {done[s] && <span className="sr-only"> (done)</span>}
              </Button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 px-1 text-ui text-ink-muted">{STAGE_AIMS[stage]}</p>
    </nav>
  );
}

/** What to keep in mind at each stage, in the rail beside it. */
export const STAGE_TIPS: Record<Stage, string[]> = {
  discover: [
    'A good question is one a reasonable person could answer differently.',
    'Your answer can change later. Write what you think today.',
    'Reply to Dash’s notes in a line or two, change your answers above if a note shows you should, then have Dash read it again.',
  ],
  research: [
    'Read where the debate stands, then what supports you and what pushes back.',
    'Note your take on anything that matters to your answer. The Plan step can turn those notes into points.',
    'Spend longest on what pushes back. That is the objection your reader will raise.',
  ],
  plan: [
    'Your thesis is your answer in one sentence that a reader could disagree with.',
    'Three to five points is plenty for a short essay. Make each one a claim, not a topic: “preventive controls beat detective ones”, not “controls”.',
    'Find points looks through everything you have written so far and lifts out passages word for word, so the points stay yours.',
  ],
  structure: [
    'Pick a shape, then fill any empty part in your own words. An empty part shows you what the essay is missing.',
    'For each part, ask whether the reader needs the one before it to follow it.',
    'Put the strongest objection where your reader would raise it, not at the very end.',
  ],
  develop: [
    'Answer in rough notes. Nobody reads them but you.',
    'Two or three answers per point is usually enough to write it.',
    'If you cannot answer a question about a point, the point may need narrowing.',
  ],
  write: [
    'Put the outline in the draft and write under each heading.',
    'Your notes for the section you are in are in the plan beside you.',
    'Run the checks when a section is done, not while you are drafting it.',
  ],
};

/**
 * The rail beside a stage: what the stage is for, what to keep in mind, and
 * what the essay is answering so far.
 */
export function StageGuide({
  stage,
  brief,
  plan,
}: {
  stage: Stage;
  brief: EssayBrief;
  plan: EssayPlan;
}) {
  const thesis = plan.thesis.trim() || brief.claim.trim();
  return (
    <Card padding="none">
      <CardSection title={`${STAGE_LABELS[stage]}: how this step works`}>
        <ul className="flex list-disc flex-col gap-2 pl-4 text-ui text-ink">
          {STAGE_TIPS[stage].map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </CardSection>
      {(brief.question.trim() || thesis) && (
        <CardSection title="Your essay so far">
          {brief.question.trim() && (
            <>
              <p className="text-small text-ink-muted">Question</p>
              <p className="mb-2 text-ui text-ink">{brief.question.trim()}</p>
            </>
          )}
          {thesis && (
            <>
              <p className="text-small text-ink-muted">
                {plan.thesis.trim() ? 'Thesis' : 'Your answer'}
              </p>
              <p className="line-clamp-4 text-ui text-ink">{thesis}</p>
            </>
          )}
          {plan.points.some((p) => p.text.trim()) && (
            <>
              <p className="mt-2 text-small text-ink-muted">Points</p>
              <ol className="flex flex-col gap-1 text-ui text-ink">
                {plan.points
                  .filter((p) => p.text.trim())
                  .map((p, i) => (
                    <li key={p.id} className="flex gap-1.5">
                      <span className="tabular-nums text-ink-muted">{i + 1}.</span>
                      <span className="line-clamp-2 min-w-0">{p.text.trim()}</span>
                    </li>
                  ))}
              </ol>
            </>
          )}
        </CardSection>
      )}
    </Card>
  );
}

/** The foot of a stage: where to go next, with a line saying what that is. */
export function NextStage({
  stage,
  onStage,
  ready,
  hint,
}: {
  stage: Stage;
  onStage: (stage: Stage) => void;
  /** True when the stage has enough in it; the button is quieter until then, never disabled. */
  ready: boolean;
  /** What is still worth doing here, shown when it is not ready. */
  hint?: string;
}) {
  const next = nextStage(stage);
  if (!next) return null;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-ui text-ink-muted">
        {ready ? STAGE_AIMS[next] : (hint ?? STAGE_AIMS[next])}
      </p>
      <Button type="button" variant={ready ? 'primary' : 'secondary'} onClick={() => onStage(next)}>
        Next: {STAGE_LABELS[next]}
      </Button>
    </div>
  );
}
