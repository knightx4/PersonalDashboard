import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * The container.
 *
 * There is no shadow at rest: depth is a 1px border on a surface over a
 * canvas. Shadow belongs only to things genuinely floating -- menus and
 * popovers -- and transiently on `lift` hover.
 *
 * Lightbox is the one exception and it is handled by `sheet`, not here: on a
 * black bench a card is an object, and an object has an edge. In the other
 * four themes `sheet` resolves to the ordinary hairline and nothing else. See
 * the token comments in app/globals.css.
 *
 * Padding is a variant rather than fixed, and a header is optional, because
 * the previous version of this component insisted on both and so nobody used
 * it. The utility string it was competing with had been hand-written in over
 * a hundred places, which is how card padding ended up as p-3, p-4, p-5 and
 * p-8 depending on who wrote the file. Both variants derive from the density
 * dial, so the whole app tightens together.
 */
const card = cva('sheet rounded-card border bg-surface', {
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
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padding?: 'standard' | 'dense';
  id?: string;
}) {
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
