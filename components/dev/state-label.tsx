import { StatusGlyph } from '@/components/ui/status-glyph';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';

/**
 * A row's state, drawn the one way the dev pages draw it.
 *
 * Four of the five queues had a hand-rolled pill each -- a tinted lozenge here,
 * a bare grey word there -- and the plan had the hexagon. So the same fact was
 * a shape on one tab and a coloured capsule on the next, and a reader coming
 * from one to the other had nothing to carry across.
 *
 * Shape and word together: lib/status-glyphs.ts says which hexagon, and
 * lib/dev/words.ts says which word. This puts them beside each other and tones
 * them, and that is all it does.
 *
 * The `title` is what the state means and what, if anything, you need to do,
 * in a sentence. It shows in the shared Tooltip rather than the browser's own
 * title (plan #1985.5), and the label takes a tab stop so a keyboard reaches
 * it too. Inside a link or a button the label cannot hold a tab stop of its
 * own: pass `focusable={false}` there, and the tip shows on hover alone.
 */

/**
 * The six tones a state can take. `info` is the app's blue rather than the
 * accent, which is whichever hue the workspace owns and would make one state
 * six colours across six pages.
 */
export type DevTone = 'quiet' | 'ghost' | 'accent' | 'info' | 'positive' | 'caution';

export const TONE_TEXT: Record<DevTone, string> = {
  quiet: 'text-ink-muted',
  ghost: 'text-ink-ghost',
  accent: 'text-accent',
  info: 'text-status-submitted',
  positive: 'text-positive',
  caution: 'text-caution',
};

export function StateLabel({
  glyph,
  word,
  tone,
  /** What the state means and what you need to do, shown in the Tooltip. */
  title,
  /** False inside a link or a button, which already holds the tab stop. */
  focusable = true,
  /** `end` for a label near the right edge, so the tip hangs inward. */
  align,
  /** Start with the tip showing. For the preview gallery's shots. */
  defaultOpen,
  /** What sits between the glyph and the word: the bot on a row a session has. */
  children,
  className,
  /** Classes for the word alone, such as hiding it at one width. */
  wordClassName,
}: {
  glyph: GlyphName | null;
  word: string;
  tone: DevTone;
  title?: string;
  focusable?: boolean;
  align?: 'start' | 'end';
  defaultOpen?: boolean;
  children?: React.ReactNode;
  className?: string;
  wordClassName?: string;
}) {
  const label = (
    <span
      className={cn('inline-flex items-center gap-1.5 text-small', TONE_TEXT[tone], className)}
      tabIndex={title && focusable ? 0 : undefined}
    >
      {glyph && <StatusGlyph glyph={glyph} />}
      {children}
      <span className={cn('truncate', wordClassName)}>{word}</span>
    </span>
  );
  if (!title) return label;
  return (
    <Tooltip label={title} align={align} defaultOpen={defaultOpen} className="min-w-0 max-w-full">
      {label}
    </Tooltip>
  );
}
