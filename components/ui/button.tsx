import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A press area of at least 44 by 44 pixels on a phone, without changing what
 * the control looks like: an invisible ::after centred on the control, as
 * tall and wide as the control or 44 pixels, whichever is more. The phone
 * checks (docs/UI-QUALITY-SPEC.md, Part 5) measure a control with that
 * pseudo-element included. Below `sm` only, because a mouse does not need it
 * and a dense table row on a laptop would otherwise have its neighbours'
 * press areas reaching into it.
 *
 * `relative` holds the pseudo-element to the control. It is unconditional so
 * that a caller passing `absolute` or `sticky` replaces it through `cn`; a
 * `max-sm:relative` would win over theirs at phone width instead.
 */
export const PRESS_AREA =
  'relative max-sm:after:absolute max-sm:after:top-1/2 max-sm:after:left-1/2 ' +
  'max-sm:after:h-full max-sm:after:min-h-11 max-sm:after:w-full max-sm:after:min-w-11 ' +
  'max-sm:after:-translate-x-1/2 max-sm:after:-translate-y-1/2';

/**
 * Simple, with interactive elements that make it feel alive without getting in
 * the way: the quick duration and the soft ease (lib/motion.ts), 0.98 scale
 * on press. `press` drops out entirely under prefers-reduced-motion -- see
 * globals.css.
 */
const button = cva(
  'press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium ' +
    'transition-colors duration-quick disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    PRESS_AREA,
  {
    variants: {
      variant: {
        // A control's border is the only thing identifying it, so it is the
        // 3:1 token rather than the container hairline. `text-fill-ink` on the
        // primary rather than white: in a dark theme the accent is light, and
        // white on it would be unreadable.
        primary: 'bg-accent text-fill-ink hover:bg-accent-hover',
        secondary:
          'bg-surface text-ink border border-control hover:bg-sunken',
        ghost: 'text-ink-muted hover:bg-accent-tint hover:text-accent',
        danger: 'bg-surface text-danger border border-danger hover:bg-danger-tint',
      },
      /**
       * `md` reads the same variable the inputs and selects do, so a button
       * on a form row lines up with them at every density without anyone
       * measuring. `sm` and `lg` are the deliberate exceptions either side --
       * a button inside a table row, and the one button a page is about.
       */
      size: {
        sm: 'h-7 px-2.5 text-ui',
        md: 'h-(--control-h) px-3 text-ui',
        lg: 'h-9 px-4 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /**
     * The action is in flight. Disables the button and marks it busy, and
     * makes it a live region so the label it changes to -- "Saving…" -- is
     * read out rather than only seen. Pass this instead of `disabled` when
     * a transition is the reason.
     */
    pending?: boolean;
  };

export function Button({ className, variant, size, pending, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-live={pending === undefined ? undefined : 'polite'}
      {...props}
    />
  );
}

export { button as buttonVariants };
