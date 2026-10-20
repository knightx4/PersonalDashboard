/**
 * A button that hands work to a routine shows the $ and names the routine
 * (plan #2459.1).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DashAction } from '@/components/ui/dash-action';
import { ROUTINE_KEYS, ROUTINE_LABELS, routineRunsOn } from '@/lib/feedback/routine-names';

// The run hook reaches for a browser client; no run is passed here.
vi.mock('@/components/runs/use-run-going', () => ({ useRunGoing: () => false }));

describe('routine names', () => {
  it('gives every routine a label', () => {
    expect(ROUTINE_KEYS).toHaveLength(9);
    for (const key of ROUTINE_KEYS) expect(ROUTINE_LABELS[key].trim()).not.toBe('');
  });
});

describe('DashAction with a routine', () => {
  it.each(ROUTINE_KEYS)('draws the $ and names the %s routine', (routine) => {
    const closed = renderToStaticMarkup(
      createElement(DashAction, { routine }, 'Send to Dash'),
    );
    expect(closed).toContain('lucide-circle-dollar-sign');
    expect(closed).toContain(`aria-label="${routineRunsOn(routine).replace(/\.$/, '')}. Not priced per press."`);

    const open = renderToStaticMarkup(
      createElement(DashAction, { routine, hintOpen: true }, 'Send to Dash'),
    );
    expect(open).toContain(`Runs on the ${ROUTINE_LABELS[routine]} routine.`);
    expect(open).toContain('Not priced per press.');
  });

  it('draws no $ for a press that is neither priced nor a routine', () => {
    const html = renderToStaticMarkup(createElement(DashAction, {}, 'Send to Dash'));
    expect(html).not.toContain('lucide-circle-dollar-sign');
  });

  it('refuses a routine together with a price', () => {
    // @ts-expect-error a press is priced or goes to a routine, never both
    void createElement(DashAction, { routine: 'goals', paid: 'app/learn/know/actions.ts#proposeGoal' }, 'x');
    // @ts-expect-error the same for a figure worked out already
    void createElement(DashAction, { routine: 'goals', costText: '$1' }, 'x');
  });
});
