import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * Simple, with interactive elements that make it feel alive without getting in
 * the way: 150ms ease-out, 0.98 scale on press. `press` drops out entirely
 * under prefers-reduced-motion -- see globals.css.
 */
const button = cva(
  'press inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
    'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2',
  {
    variants: {
      variant: {
        // A control's border is the only thing identifying it, so it is the
        // 3:1 token rather than the container hairline. `text-surface` on the
        // primary rather than white: in a dark theme the accent is light, and
        // white on it would be unreadable.
        primary: 'bg-accent text-surface hover:bg-accent-hover',
        secondary:
          'bg-surface text-ink border border-control hover:border-ink-muted hover:bg-sunken',
        ghost: 'text-ink-muted hover:bg-accent-tint hover:text-accent',
        danger: 'bg-surface text-danger border border-danger hover:bg-danger-tint',
      },
      size: {
        sm: 'h-8 px-3 text-ui',
        md: 'h-10 px-4 text-body',
        lg: 'h-11 px-5 text-lead',
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
