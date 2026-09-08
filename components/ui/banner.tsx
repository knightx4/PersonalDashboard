import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * One banner, four tones.
 *
 * There were three unrelated implementations of this, one of them in raw
 * emerald-50/emerald-200/emerald-950 with no token in sight -- which meant it
 * was a bug in four of the five themes the moment a second theme existed.
 *
 * The tone is a claim, not a colour choice:
 *   info     something is happening that you did not start and need not act on
 *   warn     something is wrong and only you can fix it; always carries the action
 *   bad      a source failed, so this page is incomplete and says so
 *   good     money came back; nothing else
 *
 * A banner is the second-most expensive rung of the attention ladder. Use it
 * only for "this page is not telling you the whole truth right now" -- anything
 * the system merely *did* belongs in the status line instead.
 */
const banner = cva(
  // A sheet the size of a paragraph, so under Lightbox it has the edge the
  // cards have and sits on the bench the same way.
  'sheet flex items-start gap-2.5 rounded-card border px-4 py-3 text-body text-ink',
  {
    variants: {
      tone: {
        info: 'bg-accent-tint',
        warn: 'bg-caution-tint',
        bad: 'bg-danger-tint',
        good: 'bg-positive-tint',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

const ICONS = {
  info: { Glyph: Info, className: 'text-accent' },
  warn: { Glyph: AlertTriangle, className: 'text-caution' },
  bad: { Glyph: XCircle, className: 'text-danger' },
  good: { Glyph: CheckCircle2, className: 'text-positive' },
} as const;

export type BannerProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof banner> & {
    /** Set false where the surrounding copy already carries the signal. */
    icon?: boolean;
  };

export function Banner({ className, tone, icon = true, children, ...props }: BannerProps) {
  const { Glyph, className: iconClass } = ICONS[tone ?? 'info'];
  return (
    <div
      role={tone === 'bad' || tone === 'warn' ? 'status' : undefined}
      className={cn(banner({ tone }), className)}
      {...props}
    >
      {icon && <Glyph className={cn('mt-0.5 size-4 shrink-0', iconClass)} strokeWidth={1.75} aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
