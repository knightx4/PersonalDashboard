import { ChevronRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * The container.
 *
 * No shadow and no border at rest: depth is tone. A surface sits six percent
 * above the canvas it lies on, which is enough to be an object without
 * anything being drawn round it. It used to be three percent, and a 1px
 * border was doing the work that difference could not -- the whole app wearing
 * an edge because one theme's two greys were too close together. See the
 * `--c-canvas` note in app/globals.css.
 *
 * Shadow still belongs only to things genuinely floating -- menus, popovers,
 * and the page pane itself -- and transiently on `lift` hover.
 *
 * Lightbox is the one exception and it is handled by `sheet`, not here: on a
 * black bench a card is an object, and an object has an edge. In the other
 * three themes `sheet` resolves to the ordinary hairline and nothing else. See
 * the token comments in app/globals.css.
 *
 * Padding is a variant rather than fixed, and a header is optional, because
 * the previous version of this component insisted on both and so nobody used
 * it. The utility string it was competing with had been hand-written in over
 * a hundred places, which is how card padding ended up as p-3, p-4, p-5 and
 * p-8 depending on who wrote the file. Both variants derive from the density
 * dial, so the whole app tightens together.
 */
const card = cva('sheet rounded-card bg-surface', {
  variants: {
    /** standard: a card the eye rests on. dense: a card holding a list. */
    padding: { standard: 'card-pad', dense: 'card-pad-dense', none: '' },
    interactive: { true: 'lift cursor-pointer', false: '' },
  },
  defaultVariants: { padding: 'none', interactive: false },
});

export type CardProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof card>;

export function Card({ className, padding, interactive, ...props }: CardProps) {
  return <div className={cn(card({ padding, interactive }), className)} {...props} />;
}

/** The card's classes without the element, for a <Link> or <li> that is a card. */
export const cardVariants = card;

/**
 * Only for a card using `padding="none"`. A card with its own padding puts its
 * title in whatever heading the page needs instead.
 */
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card-pad-x pt-(--card-p) pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-ui font-semibold text-ink', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card-pad-x pb-(--card-p)', className)} {...props} />;
}

/**
 * A section of a page that looks like a card and has a heading. The shape
 * roughly half the app was hand-rolling.
 */
export function CardSection({
  title,
  hint,
  action,
  children,
  className,
  padding = 'dense',
  id,
  fold,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: 'standard' | 'dense';
  id?: string;
  /**
   * Makes the section fold away (law 10). `meta` is what the closed heading
   * says -- a count, a total, the one fact that makes opening it a choice --
   * and is required, because a fold that hides whether it is worth opening
   * has moved the work rather than saved it.
   */
  fold?: { meta: React.ReactNode; defaultOpen?: boolean };
}) {
  if (fold) {
    // Native <details>, like Disclosure: it folds before JavaScript loads and
    // the keyboard comes free. The action sits at the top of the open body
    // rather than in the heading, because a button inside <summary> toggles
    // the fold as well as doing its own job.
    return (
      <Card id={id} padding={padding} className={className} data-slot="section">
        <details open={fold.defaultOpen} className="group/fold">
          <summary className="press flex cursor-pointer list-none items-baseline gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0 self-center text-ink-muted transition-transform duration-150 group-open/fold:rotate-90"
            />
            <h2 className="text-ui font-semibold text-ink">{title}</h2>
            <span className="text-small text-ink-muted">{fold.meta}</span>
          </summary>
          <div className="mt-2">
            {action && <div className="mb-2 flex justify-end">{action}</div>}
            {hint && <p className="mb-2 text-small text-ink-muted">{hint}</p>}
            {children}
          </div>
        </details>
      </Card>
    );
  }

  return (
    <Card id={id} padding={padding} className={className} data-slot="section">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-ui font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {hint && <p className="mb-2 text-small text-ink-muted">{hint}</p>}
      {children}
    </Card>
  );
}

/**
 * A list short enough to read in passing starts open; past this it starts
 * folded, with its count on the closed line.
 */
export const FOLD_OPEN_AT = 5;

/**
 * The fold for a section that lists things: its count on the closed line, and
 * open only while the list is short enough not to push the page down.
 */
export function foldCount(
  count: number,
  one: string,
  many = `${one}s`,
): { meta: string; defaultOpen: boolean } {
  return {
    meta: count === 0 ? `No ${many}` : `${count} ${count === 1 ? one : many}`,
    defaultOpen: count <= FOLD_OPEN_AT,
  };
}

/** Prose that fits in a glance starts open; longer text starts folded. */
const FOLD_OPEN_WORDS = 80;

/** The fold for a section that is one block of prose: its length on the closed line. */
export function foldWords(text: string | null | undefined): { meta: string; defaultOpen: boolean } {
  const words = text?.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    meta: words === 0 ? 'Empty' : `${words} ${words === 1 ? 'word' : 'words'}`,
    defaultOpen: words <= FOLD_OPEN_WORDS,
  };
}
