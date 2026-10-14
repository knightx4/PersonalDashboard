import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A static label: a status, a kind, a count. Never pressable; a chip you
 * press to pick it is a ToggleChip, below.
 *
 * One shape, the pill radius, which is round everywhere and square only in
 * Poster, where everything is. Two sizes: `md` at small text for a chip
 * beside a title, `sm` at micro text inside a dense row. Never uppercase.
 *
 * A tone only when the colour says something (law 4): caution for "needs
 * you", danger for a failure, positive for done, accent for "yours" or
 * "selected". Most chips are neutral. Before this existed there were about
 * sixty hand-written chips in four radii and four grounds, and the 37 that
 * used `rounded-pill` drew square, because nothing defined it.
 *
 * Numbers line up (tabular). An icon goes first and is sized by the chip.
 * A label that can run long goes in `<span className="min-w-0 truncate">`
 * with `max-w-full` on the chip, so it ends in an ellipsis inside its row
 * instead of pushing the page sideways.
 */
export const chipVariants = cva(
  'tabular inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill font-medium [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'bg-sunken text-ink-muted',
        accent: 'bg-accent-tint text-accent',
        caution: 'bg-caution-tint text-caution',
        danger: 'bg-danger-tint text-danger',
        positive: 'bg-positive-tint text-positive',
      },
      size: {
        sm: 'h-4.5 px-1.5 text-micro [&_svg]:size-3',
        md: 'h-5.5 px-2 text-small [&_svg]:size-3.5',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export type ChipTone = NonNullable<VariantProps<typeof chipVariants>['tone']>;

export function Chip({
  tone,
  size,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chipVariants>) {
  return <span className={cn(chipVariants({ tone, size }), className)} {...props} />;
}

/**
 * A chip pressed to pick it: a day picker, a filter row, a grouping row.
 *
 * When on it wears the same accent tint and accent ink as Segmented and Tabs,
 * so a page with both has one meaning of "selected". The copies it replaced
 * used a filled accent in some places and the tint in others.
 *
 * `toggleChipClass(on)` is the same look for a Link, for a row of chips that
 * are addresses (`?group=week`) rather than buttons.
 */
export function toggleChipClass(on: boolean): string {
  return cn(
    'press press-area inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-pill border px-3 text-small font-medium',
    'transition-colors duration-quick focus-visible:outline-2 focus-visible:outline-offset-2 [&_svg]:size-3.5',
    on
      ? 'border-transparent bg-accent-tint text-accent'
      : 'border-border bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
  );
}

export function ToggleChip({
  on,
  className,
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button type={type} aria-pressed={on} className={cn(toggleChipClass(on), className)} {...props} />
  );
}
