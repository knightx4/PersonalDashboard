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
        primary: 'bg-brand text-white hover:bg-brand-hover',
        secondary:
          'bg-surface text-ink border border-border hover:border-border-strong hover:bg-canvas',
        ghost: 'text-ink-muted hover:bg-brand-tint hover:text-brand',
        danger: 'bg-surface text-red-600 border border-red-200 hover:bg-red-50',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-[15px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

export { button as buttonVariants };
