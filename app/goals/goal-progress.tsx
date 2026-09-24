import { HelpCircle } from 'lucide-react';
import { StateLabel } from '@/components/dev/state-label';
import { Bands } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import {
  PROGRESS_BANDS,
  PROGRESS_BAND_FILL,
  PROGRESS_BAND_WORD,
  goalMoveLabel,
  progressWords,
  type GoalProgress as Progress,
} from '@/lib/goals/status';

/**
 * A goal at a glance (plan #958): whose move it is, a bar of its steps by
 * state, how many are done, and how many questions wait on you.
 *
 * The bar is the plan's banded one: amber for what waits on you or on the
 * steps under it, blue for what Claude has, green for done, in that order
 * every time so the picture is comparable from one week to the next.
 */
export function GoalProgress({
  progress,
  label,
  className,
}: {
  progress: Progress;
  /** What the bar is of, read aloud before its bands: the goal's title. */
  label: string;
  className?: string;
}) {
  if (progress.live === 0 && progress.move === 'settled') return null;
  const move = goalMoveLabel(progress);

  return (
    <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {move.word && <StateLabel glyph={null} word={move.word} tone={move.tone} title={move.title} />}
      {progress.live > 0 && (
        <span className="flex items-center gap-2">
          <Bands
            bands={PROGRESS_BANDS.map((band) => ({
              key: band,
              value: progress.bands[band],
              fill: PROGRESS_BAND_FILL[band],
              label: `${progress.bands[band]} ${PROGRESS_BAND_WORD[band]}`,
            }))}
            track="sunken"
            className="w-24"
            label={label}
          />
          <span className="tabular text-small text-ink-muted">{progressWords(progress)}</span>
        </span>
      )}
      <QuestionMark count={progress.questions} />
    </span>
  );
}

/**
 * The plan's marker for questions waiting on you, on a row that holds them
 * out of sight.
 */
export function QuestionMark({ count }: { count: number }) {
  if (count === 0) return null;
  const words = `${count} ${count === 1 ? 'question' : 'questions'} waiting on your answer`;
  return (
    <span
      title={words}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-caution-tint px-1.5 text-small font-semibold text-caution"
    >
      <HelpCircle className="size-3" strokeWidth={2} aria-hidden />
      {count}
      <span className="sr-only">{words}</span>
    </span>
  );
}
