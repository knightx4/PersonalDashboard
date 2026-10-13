import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A box inside a card: a warning that belongs to one row, Dash's takeaway, a
 * quoted line, a value set apart from the text around it.
 *
 * Banner is the message at the top of a page; Note is its size inside a card.
 * One radius (the control's, so it follows the theme), one inset. Before it
 * existed these were written by hand about seventy times, in five radii and
 * four paddings, with a fourth caution colour at 40% opacity.
 *
 * Tones:
 *   neutral   a sunken ground, for a value or an aside set apart
 *   accent    Dash's words or the takeaway, with an info glyph
 *   caution   something that needs the person, with a warning glyph
 *   positive  something that went right, with a check
 *   quote     someone else's words: a rule at the left and no box, so a
 *             quote never looks like the person's own note (no-bare-text)
 *
 * `glyph={false}` drops the glyph on a tone that has one, for a note so short
 * the glyph would outweigh it.
 */
const note = cva('rounded-control px-3 py-2 text-ui text-ink', {
  variants: {
    tone: {
      neutral: 'bg-sunken',
      accent: 'bg-accent-tint',
      caution: 'bg-caution-tint',
      positive: 'bg-positive-tint',
      quote: 'rounded-none border-l-2 border-border-strong py-0.5 pl-3 text-ink-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

const GLYPHS = {
  accent: { Glyph: Info, className: 'text-accent' },
  caution: { Glyph: AlertTriangle, className: 'text-caution' },
  positive: { Glyph: CheckCircle2, className: 'text-positive' },
} as const;

export type NoteProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> &
  VariantProps<typeof note> & {
    /** A bold first line, such as "The takeaway". */
    title?: React.ReactNode;
    glyph?: boolean;
  };

export function Note({ tone, title, glyph = true, className, children, ...props }: NoteProps) {
  const mark = glyph && (tone === 'accent' || tone === 'caution' || tone === 'positive') ? GLYPHS[tone] : null;
  return (
    <div
      role={tone === 'caution' ? 'status' : undefined}
      className={cn(note({ tone }), mark && 'flex items-start gap-2', className)}
      {...props}
    >
      {mark && (
        <mark.Glyph aria-hidden strokeWidth={1.75} className={cn('mt-0.5 size-3.5 shrink-0', mark.className)} />
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="text-small font-semibold text-ink">{title}</p>}
        {title ? <div className="mt-0.5">{children}</div> : children}
      </div>
    </div>
  );
}
