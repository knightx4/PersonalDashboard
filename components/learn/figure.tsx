import { Disclosure } from '@/components/ui/disclosure';
import { parseFigure } from '@/lib/learn/figures/registry';
import type { FigureBlock } from '@/lib/learn/figures/types';

/**
 * One figure on a lesson, drawn by its kind from the registry (plan #2321.1).
 *
 * The caption heads the figure. On a phone the figure folds to its caption,
 * so a lesson read on the way somewhere is not a wall of grid; the press
 * opens it. A block whose kind the app does not know, or whose spec no longer
 * parses, shows its caption alone.
 */
export function Figure({
  figure,
  defaultOpen = false,
}: {
  figure: FigureBlock;
  /** Opens the phone's fold, for the gallery's drawing of the figure open. */
  defaultOpen?: boolean;
}) {
  const drawn = parseFigure(figure);
  if (!drawn) {
    return (
      <figure className="mt-4">
        <figcaption className="text-small text-ink-muted">{figure.caption}</figcaption>
      </figure>
    );
  }
  const { Render } = drawn.kind;
  const body = <Render spec={drawn.spec} />;
  return (
    <figure className="mt-4">
      <div className="max-sm:hidden">
        <figcaption className="text-small font-semibold text-ink-muted">{figure.caption}</figcaption>
        <div className="mt-1.5">{body}</div>
      </div>
      <Disclosure
        title={figure.caption}
        defaultOpen={defaultOpen}
        className="sm:hidden"
        summaryClassName="items-start"
        bodyClassName="mt-1.5"
      >
        {body}
      </Disclosure>
    </figure>
  );
}

/** A lesson's figures, in order, after its example. */
export function Figures({ figures, defaultOpen = false }: { figures: readonly FigureBlock[]; defaultOpen?: boolean }) {
  if (figures.length === 0) return null;
  return (
    <>
      {figures.map((figure, index) => (
        <Figure key={index} figure={figure} defaultOpen={defaultOpen} />
      ))}
    </>
  );
}
