/**
 * The selection provider, and the one thing a row has to be able to rely on:
 * a page with no selection at all still renders its rows. Every list that gets
 * multi-select keeps its old callers, and they do not wrap anything.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SelectionProvider, useSelection } from '@/components/ui/selection';

function Probe() {
  const selection = useSelection();
  if (!selection) return <p>no selection here</p>;
  return <p>{selection.count} selected</p>;
}

describe('SelectionProvider', () => {
  it('leaves a component outside it rendering', () => {
    expect(renderToStaticMarkup(<Probe />)).toBe('<p>no selection here</p>');
  });

  it('starts a wrapped list with nothing selected', () => {
    const markup = renderToStaticMarkup(
      <SelectionProvider rows={[{ key: 'a' }, { key: 'b' }]}>
        <Probe />
      </SelectionProvider>,
    );
    expect(markup).toBe('<p>0 selected</p>');
  });
});
