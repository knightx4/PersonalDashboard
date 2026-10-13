import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * The class that gives a link standing on its own a press area of at least
 * 44 by 44 pixels on a phone, without changing how it looks (the
 * `press-area` utility in app/globals.css says how). Buttons and folds have
 * one already; a link inside a sentence must not take it.
 */
export const PRESS_AREA = 'press-area';

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
        // Quiet on hover: sunken ground, full ink. Accent on a hover claims
        // the button is selected (law 4); it is kept for `pressed` and for
        // the primary action.
        ghost: 'text-ink-muted hover:bg-sunken hover:text-ink',
        danger: 'bg-surface text-danger border border-danger hover:bg-danger-tint',
        // An underlined text action ("Not a match", "Regenerate"): no ground,
        // no fixed height, a quiet underline that darkens on hover. The
        // underline is what says "press me" on a phone, which has no hover.
        link:
          'rounded-none font-normal text-ink-muted underline decoration-border-strong underline-offset-2 ' +
          'hover:text-ink hover:decoration-current',
      },
      /**
       * `md` reads the same variable the inputs and selects do, so a button
       * on a form row lines up with them at every density without anyone
       * measuring. `sm` and `lg` are the deliberate exceptions either side --
       * a button inside a table row, and the one button a page is about.
       */
      size: {
        // A button inside a row ("Keep", "Undo"), beside text it must not outweigh.
        xs: 'h-6 px-1.5 text-small',
        sm: 'h-7 px-2.5 text-ui',
        md: 'h-(--control-h) px-3 text-ui',
        lg: 'h-9 px-4 text-body',
      },
      /** A button that is a toggle, when it is on. */
      pressed: {
        true: 'border-accent bg-accent-tint text-accent hover:border-accent hover:bg-accent-tint hover:text-accent',
        false: '',
      },
    },
    compoundVariants: [
      // A link-shaped action takes the size of the text it sits in, at any size.
      { variant: 'link', className: 'h-auto px-0 text-small' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', pressed: false },
  },
);

export type ButtonProps = React.ComponentProps<'button'> &
  Omit<VariantProps<typeof button>, 'pressed'> & {
    /**
     * The button is a toggle and this is its state. Sets aria-pressed and the
     * accent-tint on look; leave it out for a button that is not a toggle.
     */
    pressed?: boolean;
    /**
     * The action is in flight. Disables the button and marks it busy, and
     * makes it a live region so the label it changes to -- "Saving…" -- is
     * read out rather than only seen. Pass this instead of `disabled` when
     * a transition is the reason.
     */
    pending?: boolean;
  };

export function Button({ className, variant, size, pressed, pending, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size, pressed: pressed ?? false }), className)}
      aria-pressed={pressed}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-live={pending === undefined ? undefined : 'polite'}
      {...props}
    />
  );
}

export { button as buttonVariants };
