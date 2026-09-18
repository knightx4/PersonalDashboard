/**
 * The mark the five approval screens put on each proposed row.
 *
 * Rendered rather than asserted about, because the case that matters is the
 * absent one: a chain proposed before the distinction existed has no mark on
 * any node, and those screens have to draw the row and say nothing rather than
 * calling it a consequence or falling over.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KindBadge } from '@/components/learn/kind-badge';

describe('the door mark on a proposed concept', () => {
  it('says a door is a door', () => {
    const html = renderToStaticMarkup(<KindBadge kind="threshold" />);
    expect(html).toContain('Door');
    expect(html).toContain('text-accent');
  });

  it('says what follows from one more quietly', () => {
    const html = renderToStaticMarkup(<KindBadge kind="consequence" />);
    expect(html).toContain('Follows on');
    expect(html).toContain('text-ink-muted');
  });

  it('draws nothing for a concept nobody marked', () => {
    expect(renderToStaticMarkup(<KindBadge kind={null} />)).toBe('');
  });
});
