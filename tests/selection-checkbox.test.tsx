/**
 * The tick box a row grows on hover.
 *
 * Whether it is *visible* is decided by CSS rather than by React -- the box is
 * always in the markup, holding its space, and four variants uncover it. So
 * what a render test can pin is the thing that actually breaks: the row's
 * group name and the variant that reads it drifting apart, or the coarse
 * pointer rule going missing in a tidy-up and the box becoming unreachable on
 * a phone. Which rule a click runs is pinned in lib/selection/model.test.ts,
 * and the rules themselves beside it.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SelectionCheckbox,
  SelectionProvider,
  selectionRowClass,
} from '@/components/ui/selection';

const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

const inAList = () =>
  renderToStaticMarkup(
    <SelectionProvider rows={rows}>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className={selectionRowClass}>
            <SelectionCheckbox rowKey={row.key} label={`row ${row.key}`} />
          </li>
        ))}
      </ul>
    </SelectionProvider>,
  );

describe('SelectionCheckbox', () => {
  it('renders nothing on a list with no selection at all', () => {
    expect(
      renderToStaticMarkup(<SelectionCheckbox rowKey="a" label="row a" />),
    ).toBe('');
  });

  it('gives every row a box, named for what it selects', () => {
    const markup = inAList();
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="Select row b"');
  });

  it('starts the box hidden, with the space already held', () => {
    expect(inAList()).toContain('opacity-0');
  });

  it('uncovers the box on the row it belongs to, not just on itself', () => {
    const markup = inAList();
    expect(selectionRowClass).toBe('group/select');
    expect(markup).toContain('group-hover/select:opacity-100');
    expect(markup).toContain('group-focus-within/select:opacity-100');
    expect(markup).toContain('focus-visible:opacity-100');
  });

  it('leaves the box showing where there is no hover to wait for', () => {
    expect(inAList()).toContain('pointer-coarse:opacity-100');
  });
});
