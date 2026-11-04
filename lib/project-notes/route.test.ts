import { describe, expect, it } from 'vitest';
import type { Triage } from '@/lib/feedback/triage';
import { noteIdeaBody, noteStepDetail, noteStepTitle, outcomeLine, routesToStep } from './route';

const triage = (value: 'fix' | 'plan', confidence: number): Triage => ({
  at: '2026-11-04T00:00:00Z',
  kind: null,
  module: null,
  priority: null,
  route: { value, confidence },
  duplicate: null,
});

describe('where a note from a project app goes', () => {
  it('becomes a step only when triage is sure it is one fix', () => {
    expect(routesToStep(triage('fix', 0.95))).toBe(true);
    expect(routesToStep(triage('fix', 0.5))).toBe(false);
    expect(routesToStep(triage('plan', 0.95))).toBe(false);
    expect(routesToStep(null)).toBe(false);
  });

  it('names the step by the first line and keeps the note and page in its detail', () => {
    const body = 'The play button stutters\nwhen the dock is open.';
    expect(noteStepTitle(body)).toBe('The play button stutters');
    const detail = noteStepDetail(body, 'Song view · dock: Notes');
    expect(detail).toContain('when the dock is open.');
    expect(detail).toContain('Written on: Song view · dock: Notes');
    expect(noteIdeaBody(' Add a tempo tap ', null)).toBe('Add a tempo tap');
    expect(noteIdeaBody('Add a tempo tap', 'Song view')).toBe('Add a tempo tap\n\n(Written on: Song view)');
  });

  it('tells the app where the note went', () => {
    expect(outcomeLine({ as: 'step', number: 2812 })).toBe('Added to the plan as step #2812.');
    expect(outcomeLine({ as: 'idea' })).toBe('Sent to Dash to shape into the plan.');
  });
});
