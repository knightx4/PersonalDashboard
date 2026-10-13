/* ui-ok-file: hand-rolled-box -- these are the proposed primitives themselves; when accepted they move into components/ui. */
/* ui-ok-file: fixed-control-height -- as above: xs, sm and lg sizes and the 28px chip are deliberate steps either side of the dial, as in button.tsx. */

import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PRESS_AREA } from '@/components/ui/button';

/**
 * The proposed versions of the shared components, drawn on /preview/overhaul.
 *
 * Nothing in the app imports these. They exist so /preview/overhaul can draw
 * each proposal beside what the app draws today, on the real tokens and in
 * whichever theme the page is opened in. When a proposal is accepted it moves
 * into components/ui and the call sites move onto it; this file is the
 * drawing, not the component.
 */

/* ------------------------------------------------------------------ Button */

/**
 * Today's Button with three additions: a `link` variant for the underlined
 * text actions ("Not a match", "Regenerate"), an `xs` size for the small
 * ghost buttons inside rows ("Keep"), and `pressed` for a button that is a
 * toggle. Ghost hover goes quiet (sunken ground, full ink) so that accent is
 * left to mean "on" or "the one to press".
 */
export const proposedButton = cva(
  'press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium ' +
    'transition-colors duration-quick disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    PRESS_AREA,
  {
    variants: {
      variant: {
        primary: 'bg-accent text-fill-ink hover:bg-accent-hover',
        secondary: 'bg-surface text-ink border border-control hover:bg-sunken',
        ghost: 'text-ink-muted hover:bg-sunken hover:text-ink',
        danger: 'bg-surface text-danger border border-danger hover:bg-danger-tint',
        link:
          'rounded-none font-normal text-ink-muted underline decoration-border-strong underline-offset-2 ' +
          'hover:text-ink hover:decoration-current',
      },
      size: {
        xs: 'h-6 px-1.5 text-small',
        sm: 'h-7 px-2.5 text-ui',
        md: 'h-(--control-h) px-3 text-ui',
        lg: 'h-9 px-4 text-body',
      },
      pressed: {
        true: 'border-accent bg-accent-tint text-accent hover:bg-accent-tint',
        false: '',
      },
    },
    compoundVariants: [
      { variant: 'link', size: ['xs', 'sm', 'md', 'lg'], className: 'h-auto px-0 text-small' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', pressed: false },
  },
);

export function ProposedButton({
  className,
  variant,
  size,
  pressed,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  Omit<VariantProps<typeof proposedButton>, 'pressed'> & { pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(proposedButton({ variant, size, pressed: pressed ?? false }), className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------- IconButton */

/**
 * One icon button in place of IconActionButton and about fifty hand-written
 * copies at sizes 4 to 8. Two sizes, one radius (the control's, so it follows
 * the theme), one hover. `active` is the only state that uses accent. The
 * press area is 44px on a phone at either size.
 */
const iconButton = cva(
  'press press-area inline-flex shrink-0 items-center justify-center rounded-control text-ink-muted ' +
    'transition-colors duration-quick hover:bg-sunken hover:text-ink ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      size: { sm: 'size-6 [&_svg]:size-3.5', md: 'size-8 [&_svg]:size-4' },
      active: { true: 'bg-accent-tint text-accent hover:bg-accent-tint hover:text-accent', false: '' },
    },
    defaultVariants: { size: 'md', active: false },
  },
);

export function IconButton({
  label,
  size,
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(iconButton({ size, active: active ?? false }), className)}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- Chip */

/**
 * The static label: a status, a kind, a count. Never pressable (that is
 * ToggleChip). One shape, rounded-full; two sizes; a tone only when the
 * colour says something (law 4), so most chips are neutral.
 */
const chip = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:shrink-0',
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

export function Chip({
  tone,
  size,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chip>) {
  return <span className={cn(chip({ tone, size }), 'tabular', className)} {...props} />;
}

/* -------------------------------------------------------------- ToggleChip */

/**
 * A chip that is pressed to pick it: day pickers, filter rows, scope rows.
 * The on state is the one Segmented and Tabs already use, accent tint with
 * accent ink, so a page with chips and a Segmented on it has one meaning of
 * "selected" instead of two.
 */
export function ToggleChip({
  on,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        'press press-area inline-flex h-7 items-center gap-1 rounded-full border px-3 text-small font-medium',
        'transition-colors duration-quick focus-visible:outline-2 focus-visible:outline-offset-2',
        on
          ? 'border-transparent bg-accent-tint text-accent'
          : 'border-border bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ SegmentedRow */

/**
 * Segmented's look as a class function, so a row of links (a view switch, a
 * scope switch) can wear it without copying the string. Nine files copy it by
 * hand today, and one of them at h-7, off the density dial.
 */
export function segmentClass(on: boolean): string {
  return cn(
    'press inline-flex h-(--control-h) items-center gap-1.5 px-2.5 text-ui font-medium',
    'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
    on ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
  );
}

/* -------------------------------------------------------------------- Link */

/**
 * Two looks for a link, exported as classes for ui/link and for an <a>:
 * `inline` for a link inside a sentence, `quiet` for a link that sits under a
 * row as metadata. Both are underlined, because an underline is what says
 * "link" to someone not hovering (a phone has no hover).
 */
export const linkVariants = cva('underline underline-offset-2 transition-colors duration-quick', {
  variants: {
    tone: {
      inline: 'text-accent decoration-accent/40 hover:decoration-accent',
      quiet: 'text-ink-muted decoration-border-strong hover:text-ink hover:decoration-current',
    },
  },
  defaultVariants: { tone: 'inline' },
});

/* ---------------------------------------------------------- Checkbox/Switch */

/**
 * The native checkbox, coloured by the accent token. Today three spellings
 * exist, and the most common one (`rounded border-border text-accent`) does
 * nothing, because the forms plugin it was written for is not installed.
 */
export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

/** A checkbox with its title and a line under it: the shape repeated about ten times. */
export function CheckRow({
  title,
  hint,
  defaultChecked,
}: {
  title: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="press-area flex cursor-pointer items-start gap-3 rounded-control py-1">
      <Checkbox defaultChecked={defaultChecked} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-ui text-ink">{title}</span>
        {hint && <span className="mt-0.5 block text-small text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

/* --------------------------------------------------------- Section headings */

/**
 * The heading of a group of things inside a page or a card: ui size,
 * semibold, with an optional count beside it and the action on the same line.
 * An icon is not part of it. Today one card on a page has an icon in its
 * heading and the next does not.
 */
export function SectionHeading({
  title,
  count,
  action,
  as: Tag = 'h2',
}: {
  title: string;
  count?: React.ReactNode;
  action?: React.ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <Tag className="text-ui font-semibold text-ink">
        {title}
        {count !== undefined && (
          <span className="tabular ml-2 text-small font-normal text-ink-muted">{count}</span>
        )}
      </Tag>
      {action}
    </div>
  );
}

/**
 * The small label over a field or a group of values inside a card ("Salary",
 * "What they asked"). GroupHeader without the count it insists on, which is
 * why five places use GroupHeader and seventy-nine write their own.
 */
export function SectionLabel({ children, count }: { children: React.ReactNode; count?: React.ReactNode }) {
  return (
    <p className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
      {children}
      {count !== undefined && (
        <span className="tabular ml-2 font-normal normal-case tracking-normal">{count}</span>
      )}
    </p>
  );
}

/* -------------------------------------------------------------------- Note */

/**
 * A box inside a card: a quote, a warning that belongs to one row, Dash's
 * takeaway. Banner stays for the page-level message; Note is its size inside
 * a card. One radius (the control's), one inset, a tone only when there is
 * something to say.
 */
const note = cva('rounded-control px-3 py-2 text-ui text-ink', {
  variants: {
    tone: {
      neutral: 'bg-sunken',
      accent: 'bg-accent-tint',
      caution: 'bg-caution-tint',
      quote: 'rounded-none border-l-2 border-border-strong bg-transparent py-0.5 pl-3 text-ink-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

const NOTE_GLYPHS = {
  accent: { Glyph: Info, className: 'text-accent' },
  caution: { Glyph: AlertTriangle, className: 'text-caution' },
  positive: { Glyph: CheckCircle2, className: 'text-positive' },
} as const;

export function Note({
  tone,
  title,
  children,
}: VariantProps<typeof note> & { title?: string; children: React.ReactNode }) {
  const glyph = tone === 'accent' || tone === 'caution' ? NOTE_GLYPHS[tone] : null;
  return (
    <div className={cn(note({ tone }), glyph && 'flex items-start gap-2')}>
      {glyph && (
        <glyph.Glyph aria-hidden strokeWidth={1.75} className={cn('mt-0.5 size-3.5 shrink-0', glyph.className)} />
      )}
      <div className="min-w-0">
        {title && <p className="text-small font-semibold text-ink">{title}</p>}
        <div className={cn(title && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- EmptyState */

/**
 * EmptyState in three sizes. `page` is today's component. `box` replaces the
 * dashed cards written by hand at py-6, py-8 and py-10. `inline` replaces
 * the bare "No steps yet" lines, and gives each one the action that ends it.
 */
export function ProposedEmpty({
  size,
  title,
  description,
  action,
}: {
  size: 'box' | 'inline';
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  if (size === 'inline') {
    return (
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1 text-ui text-ink-muted">
        {title}
        {action}
      </p>
    );
  }
  return (
    <div className="sheet flex flex-col items-center rounded-card border border-dashed bg-surface px-4 py-8 text-center">
      <p className="text-ui font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-small text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------- Stat */

/**
 * A number with its label, smaller than Figure. Figure is the one number a
 * page is about; Stat is one of several in a row. Today these are written by
 * hand at text-body and text-title, with tracking on some and not others.
 */
export function Stat({
  value,
  label,
  size = 'md',
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          'tabular font-semibold tracking-tight text-ink',
          size === 'md' ? 'font-display text-title' : 'text-body',
        )}
      >
        {value}
      </p>
      <p className="text-small text-ink-muted">{label}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- LiveDot */

/**
 * The dot that says something is running. Four places draw it by hand, at
 * size-1.5 with animate-pulse, which fades the dot itself in and out. This
 * keeps the dot solid and pulses a ring behind it, so it reads as on at every
 * moment, and it stops under reduced motion.
 */
export function LiveDot({ tone = 'accent' }: { tone?: 'accent' | 'caution' }) {
  const fill = tone === 'caution' ? 'bg-caution' : 'bg-accent';
  return (
    <span aria-hidden className="relative inline-flex size-2 shrink-0">
      <span className={cn('absolute inset-0 rounded-full opacity-50 motion-safe:animate-ping', fill)} />
      <span className={cn('relative inline-flex size-2 rounded-full', fill)} />
    </span>
  );
}

/* --------------------------------------------------------------- Menu panel */

/** One floating surface for menus, popovers and autocomplete lists. */
export const proposedSurface =
  'popover-panel rounded-card border border-border bg-raised p-1 shadow-lg';

/** One menu row: control radius, sunken hover like every other quiet press. */
export function menuItemClass(destructive = false): string {
  return cn(
    'press flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-ui transition-colors duration-quick',
    destructive ? 'text-danger hover:bg-danger-tint' : 'text-ink hover:bg-sunken',
  );
}
