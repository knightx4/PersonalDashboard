import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * A button that is only an icon: a row's quick action, a close, a fold, a
 * menu trigger.
 *
 * Two sizes. `md` is 32px with a 16px icon, the default anywhere a button
 * stands on its own; `sm` is 24px with a 14px icon, for inside a row of text.
 * The size sets the icon's size through `[&_svg]`, so a call site passes the
 * bare icon and cannot get the pairing wrong. Fifty copies of this were
 * written by hand at five sizes and four radii before it existed.
 *
 * The radius is the control's, so it follows the theme (rounder in Aurora,
 * square in Poster). Hover is quiet, a sunken ground and full ink; `active`
 * (a menu that is open, a toggle that is on) is the only state that uses the
 * accent. The press area is 44px on a phone at either size.
 *
 * `label` is required: it is the accessible name and the tooltip, because an
 * icon alone names nothing to a screen reader.
 */
export const iconButtonVariants = cva(
  'press press-area inline-flex shrink-0 items-center justify-center rounded-control text-ink-muted ' +
    'transition-colors duration-quick hover:bg-sunken hover:text-ink ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40 ' +
    '[&_svg]:shrink-0',
  {
    variants: {
      size: { sm: 'size-6 [&_svg]:size-3.5', md: 'size-8 [&_svg]:size-4' },
      active: {
        true: 'bg-accent-tint text-accent hover:bg-accent-tint hover:text-accent',
        false: '',
      },
    },
    defaultVariants: { size: 'md', active: false },
  },
);

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size, active, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ size, active: active ?? false }), className)}
      {...props}
    >
      {children}
    </button>
  );
});
