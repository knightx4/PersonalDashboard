/**
 * The header giving its place to the action bar.
 *
 * Which of the two is showing is decided by CSS -- the heading is in the
 * markup either way, holding the header's height, and a rule hides it when a
 * bar is rendered into the same cell. So what a render test can pin is the
 * pair of class names that have to agree across two files: the group the
 * header names and the attribute the bar carries. If either drifts, the bar
 * draws on top of the title and nobody notices until a screenshot.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader } from '@/components/shell/page-header';
import { SelectionActionBar, SelectionProvider } from '@/components/ui/selection';

describe('PageHeader with a bulk slot', () => {
  it('leaves the heading alone on a page that passes no bulk actions', () => {
    const markup = renderToStaticMarkup(<PageHeader title="Review" description="Six waiting" />);
    expect(markup).toContain('Review');
    expect(markup).toContain('Six waiting');
    // The class name says the attribute too, so the attribute itself is what
    // is being looked for.
    expect(markup).not.toContain('data-selection-bar=');
  });

  it('hides the heading by the attribute the bar carries', () => {
    const markup = renderToStaticMarkup(
      <PageHeader title="Review" bulk={<div data-selection-bar />} />,
    );
    expect(markup).toContain('group-has-[[data-selection-bar]]/header:invisible');
    expect(markup).toContain('group/header');
    expect(markup).toContain('data-selection-bar=');
  });

  it('puts the heading and the bar in the same grid cell', () => {
    const markup = renderToStaticMarkup(
      <PageHeader title="Review" bulk={<div data-selection-bar />} />,
    );
    expect(markup.match(/col-start-1 row-start-1/g)).toHaveLength(1);
    expect(
      renderToStaticMarkup(
        <SelectionProvider rows={[{ key: 'a' }]}>
          <SelectionActionBar />
        </SelectionProvider>,
      ),
    ).toBe('');
  });
});
