import { Disclosure } from '@/components/ui/disclosure';
import { parseFigure } from '@/lib/learn/figures/registry';
import type { FigureBlock } from '@/lib/learn/figures/types';

/**
 * One figure on a lesson, drawn by its kind from the registry (plan #2321.1).
 *
 * The caption heads the figure. On a phone the figure folds to its caption,
 * so a lesson read on the way somewhere is not a wall of grid; the press
 * opens it. A block whose kind the app does not know, or whose spec no longer
 * parses, shows its caption alone; one whose data could not be fetched, or
 * that asks for a figure the app cannot draw yet, shows its caption and
 * says so.
 */
export function Figure({
  figure,
  defaultOpen = false,
  unfolded = false,
}: {
  figure: FigureBlock;
  /** Opens the phone's fold, for the gallery's drawing of the figure open. */
  defaultOpen?: boolean;
  /** Never folds, on any width: a question on the figure (plan #2321.5) cannot be answered from its caption. */
  unfolded?: boolean;
}) {
  const drawn = parseFigure(figure);
  if (!drawn) {
    return (
      <figure className="mt-4">
        <figcaption className="text-small text-ink-muted">{figure.caption}</figcaption>
      </figure>
    );
  }
  // A figure the writer asked for that no kind can draw yet (plan #2321.9).
  if (drawn.kind.data === 'wanted') {
    const { Render } = drawn.kind;
    return (
      <figure className="mt-4">
        <figcaption className="text-small font-semibold text-ink-muted">{figure.caption}</figcaption>
        <Render spec={drawn.spec} resolved={undefined} />
      </figure>
    );
  }
  // A kind whose content is fetched and came back with nothing (plan #2321.3).
  if (drawn.kind.resolve && figure.resolved == null) {
    return (
      <figure className="mt-4">
        <figcaption className="text-small font-semibold text-ink-muted">{figure.caption}</figcaption>
        <p className="mt-0.5 text-small text-ink-muted">The data for this figure was not found.</p>
      </figure>
    );
  }
  const { Render } = drawn.kind;
  const body = <Render spec={drawn.spec} resolved={figure.resolved} />;
  if (unfolded) {
    return (
      <figure className="mt-4">
        <figcaption className="text-small font-semibold text-ink-muted">{figure.caption}</figcaption>
        <div className="mt-1.5">{body}</div>
      </figure>
    );
  }
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

/**
 * A figure drawn alone, with no caption and no fold: one option of a pick
 * question (plan #2321.5), whose label stands in for the caption. A block
 * that cannot be drawn says so in a line.
 */
export function FigureBody({ figure }: { figure: FigureBlock }) {
  const drawn = parseFigure(figure);
  if (!drawn || (drawn.kind.resolve && figure.resolved == null)) {
    return <p className="text-small text-ink-muted">This figure cannot be drawn.</p>;
  }
  const { Render } = drawn.kind;
  return <Render spec={drawn.spec} resolved={figure.resolved} />;
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
