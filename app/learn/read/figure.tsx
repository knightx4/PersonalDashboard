import { Card } from '@/components/ui/card';
import { svgProblems, type Figure } from '@/lib/learn/reader/source';

/**
 * A figure prepared with a source: a drawing and a line under it. The drawing
 * is written into the page as it was saved, so it is checked once more here
 * (svgProblems: shapes and words only, no colour of its own) and left out if
 * it does not pass. It takes its colours from the page: ink by default, the
 * accent where it is marked `accent`, quieter where `muted` or `soft`.
 */
export function ReaderFigure({ figure }: { figure: Figure }) {
  if (svgProblems(figure.svg).length > 0) return null;
  return (
    <Card padding="dense">
      <figure className="space-y-2">
        <div
          className="text-ink [&_.accent]:text-accent [&_.muted]:text-ink-muted [&_.soft]:text-border-strong [&_svg]:h-auto [&_svg]:w-full [&_text]:font-sans"
          // The drawing passed svgProblems above: shapes and words, nothing that runs.
          dangerouslySetInnerHTML={{ __html: figure.svg }}
        />
        <figcaption className="text-small text-ink-muted [overflow-wrap:anywhere]">
          {figure.caption}
        </figcaption>
      </figure>
    </Card>
  );
}
