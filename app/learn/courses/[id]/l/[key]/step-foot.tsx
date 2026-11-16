'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Map as MapIcon } from 'lucide-react';
import Link from '@/components/ui/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { markCourseProgress } from '../../../actions';

/**
 * The foot of a step: one press that marks it done and goes on. Mid-stage
 * that is the next step. At the end of a stage it is the stages that follow,
 * each named with what it gets you, so the choice of branch is made here; at
 * the end of a line it is the map. The step is marked done before the page
 * changes, so the map you arrive at already shows it.
 */

export type Onward = { href: string; title: string; about?: string; minutes?: number };

export function StepFoot({
  courseId,
  stepKey,
  done,
  stageTitle,
  onward,
  mapHref,
}: {
  courseId: string;
  stepKey: string;
  done: boolean;
  stageTitle: string;
  /** One: the next step. Several: the branches. None: the end of this line. */
  onward: { kind: 'step' | 'stages'; to: Onward[] };
  mapHref: string;
}) {
  const router = useRouter();
  const [marked, setMarked] = useState(done);
  const [going, start] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const finish = (href: string) => {
    setTarget(href);
    setFailed(false);
    start(async () => {
      if (!marked) {
        setMarked(true);
        try {
          await markCourseProgress(courseId, 'lessons', stepKey, true);
        } catch {
          // Stay on the step: going on would leave the map showing it undone.
          setMarked(false);
          setFailed(true);
          return;
        }
      }
      router.push(href);
    });
  };
  const undo = () =>
    start(async () => {
      setMarked(false);
      await markCourseProgress(courseId, 'lessons', stepKey, false);
    });

  const wide = 'h-auto min-h-11 w-full justify-start py-2.5 sm:w-auto';
  const lead = marked ? '' : 'Done. ';
  const branches = onward.kind === 'stages' && onward.to.length > 1;

  return (
    <div className="space-y-3 border-t border-border pt-5">
      {onward.kind === 'step' && onward.to[0] && (
        <Button
          type="button"
          size="lg"
          className={wide}
          pending={going && target === onward.to[0].href}
          onClick={() => finish(onward.to[0].href)}
        >
          <ArrowRight className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]">
            {lead}Next: {onward.to[0].title}
            {onward.to[0].minutes ? (
              <span className="tabular font-normal opacity-80"> · {onward.to[0].minutes} min</span>
            ) : null}
          </span>
        </Button>
      )}

      {onward.kind === 'stages' && onward.to.length > 0 && (
        <div className="space-y-3">
          <p className="text-body text-ink [overflow-wrap:anywhere]">
            {branches
              ? `That is the last step of ${stageTitle}. The course branches here: pick where to go next. You can come back for the others.`
              : `That is the last step of ${stageTitle}.`}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {onward.to.map((item) => (
              <Button
                key={item.href}
                type="button"
                variant={branches ? 'secondary' : 'primary'}
                size="lg"
                className="h-auto min-h-11 w-full justify-start py-2.5"
                pending={going && target === item.href}
                onClick={() => finish(item.href)}
              >
                <span className="min-w-0 space-y-0.5 whitespace-normal text-left [overflow-wrap:anywhere]">
                  <span className="block">
                    {branches ? '' : `${lead}Next: `}
                    {item.title}
                    {item.minutes ? (
                      <span className="tabular font-normal opacity-80"> · {item.minutes} min</span>
                    ) : null}
                  </span>
                  {item.about && (
                    <span className="block text-small font-normal opacity-80">{item.about}</span>
                  )}
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {onward.to.length === 0 && (
        <div className="space-y-3">
          <p className="text-body text-ink [overflow-wrap:anywhere]">
            That is the last step of {stageTitle}, and the end of this line of the course.
          </p>
          <Button
            type="button"
            size="lg"
            className={wide}
            pending={going && target === mapHref}
            onClick={() => finish(mapHref)}
          >
            <MapIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            {lead}Back to the map
          </Button>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-ui text-danger [overflow-wrap:anywhere]">
          That did not save, so the step is not marked done. Press it again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {onward.to.length > 0 && (
          <Link
            href={mapHref}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-11')}
          >
            <MapIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
            The map
          </Link>
        )}
        {marked && (
          <span className="flex items-center gap-2 text-small text-ink-muted">
            <Check className="size-3.5 text-positive" strokeWidth={1.75} aria-hidden />
            Done
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={going}
              onClick={undo}
            >
              Mark as not done
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
