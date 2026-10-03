import { StateLabel } from '@/components/dev/state-label';
import { DashMark } from '@/components/ui/dash-mark';
import { moveLabel, type Move } from '@/lib/core/move';

/**
 * Whose move a row is, drawn the one way every workspace draws it (plan
 * #1433; docs/CORE-AND-DASH-SPEC.md, Part 3).
 *
 * The word and tone come from lib/core/move.ts, so a row on the dev plan and
 * a goal on its page say the same thing in the same colour. No hexagon: the
 * hexagons are health, a scale from empty to full, and a move is an answer
 * to a different question. The one shape is Dash's working mark beside
 * "Dash is on it", so a run in progress reads as Dash at work rather than as
 * one more coloured word.
 *
 * `title` is the workspace's own tooltip where it has one ("Waiting on
 * another step that has not closed"); without it the shared meaning is used.
 */
export function MoveLabel({
  move,
  title,
  className,
  wordClassName,
}: {
  move: Move;
  title?: string;
  className?: string;
  /** Classes for the word alone, such as hiding it at one width. */
  wordClassName?: string;
}) {
  const label = moveLabel(move);
  return (
    <StateLabel
      glyph={null}
      word={label.word}
      tone={label.tone}
      title={title ?? label.title}
      className={className}
      wordClassName={wordClassName}
    >
      {move.state === 'dash_working' && <DashMark state="working" size="2xs" decorative />}
    </StateLabel>
  );
}
