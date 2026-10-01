/**
 * A worked list cleared on screen (plan #1340): the day's sigil draws in cell
 * by cell in under a second, and a page that loads already empty shows it at
 * once.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '@/components/ui/empty-state';
import { QUEUE_CLEARED_MS, QueueCleared } from '@/components/ui/queue-cleared';
import { Sigil, sigilCells, sigilDrawMs } from '@/components/ui/sigil';

describe('a list loaded already empty', () => {
  it('shows the sigil at once, with no draw-in', () => {
    const html = renderToStaticMarkup(
      <QueueCleared cleared>
        <EmptyState tone="finished" seed="u:2026-10-01:todo" title="Nothing on the list." description="d" />
      </QueueCleared>,
    );
    expect(html).toContain('<svg');
    expect(html).not.toContain('sigil-draw-in');
    expect(html).toMatch(/^<div class="contents">/);
  });
});

describe('the sigil drawing in', () => {
  it('numbers every cell in reading order for the stagger', () => {
    const seed = 'u:2026-10-01:todo';
    const cells = sigilCells(seed);
    const html = renderToStaticMarkup(<Sigil seed={seed} />);
    expect(html.match(/data-sigil-cell/g)).toHaveLength(cells.length);
    expect(html).toContain('--sigil-cell:0');
    expect(html).toContain(`--sigil-cell:${cells.length - 1}`);
  });

  it('is in under a second for the busiest sigil', () => {
    expect(sigilDrawMs(14)).toBe(760);
    expect(QUEUE_CLEARED_MS).toBeLessThan(1000);
    expect(sigilDrawMs(1)).toBe(240);
    expect(sigilDrawMs(0)).toBe(0);
  });

  it('lands any cell past the fourteenth with it, so no sigil takes longer', () => {
    expect(sigilDrawMs(25)).toBe(sigilDrawMs(14));
  });
});
