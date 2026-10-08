/**
 * The Status card on /dev/raised: Dash's mark, under Plan since note
 * 076e7744, works while the plan runner is firing and rests otherwise
 * (note 414ead16).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OvernightRun } from '@/lib/plan/overnight';
import type { RunnerCard } from '@/lib/plan/runner-card';

// The Plan row draws the mark it is handed and nothing else here.
vi.mock('@/app/dev/plan/overnight-control', () => ({
  OvernightControl: ({ mark }: { mark?: React.ReactNode }) => mark ?? null,
}));
vi.mock('@/components/feedback/run-routine-button', () => ({ RunRoutineButton: () => null }));
vi.mock('@/app/dev/raised/vision-review-line', () => ({ VisionReviewLine: () => null }));

const { StatusPanel } = await import('@/app/dev/raised/status-panel');

function render(run: Partial<OvernightRun> | null) {
  return renderToStaticMarkup(
    <StatusPanel
      run={run as OvernightRun | null}
      canSend
      card={{} as RunnerCard}
      goals={null}
      openNotes={0}
      notesLastRun={null}
      vision={null}
      now={0}
    />,
  );
}

describe('the Status card', () => {
  it('shows Dash working while the plan runner is firing', () => {
    expect(render({ running: true, paused: false })).toContain('data-dash-state="working"');
  });

  it('shows Dash resting when nothing is running or the runner is held', () => {
    expect(render(null)).toContain('data-dash-state="idle"');
    expect(render({ running: true, paused: true })).toContain('data-dash-state="idle"');
  });
});
