/**
 * The generated prep note on a role's round (note ad736ea2).
 *
 * A written note folds by its own heading, open to begin with, and the
 * Regenerate press sits outside the summary so pressing it never folds it.
 * Before a note exists there is nothing to fold, only the button that writes
 * one.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PrepNote } from '@/lib/jobs/interview/prep-payload';

vi.mock('@/app/jobs/(app)/roles/[id]/actions', () => ({ writeRoundPrepNote: vi.fn() }));

const { RoundPrep } = await import('@/app/jobs/(app)/roles/[id]/prep-note');

const note: PrepNote = {
  roundSummary: 'A first round with the team lead.',
  interviewers: [],
  strengths: [],
  gaps: [],
  stories: [],
  priorRoundsNote: null,
  priorQuestions: [],
  questionsToAsk: [],
  missing: [],
  bannedFound: [],
};

function render(current: PrepNote | null) {
  return renderToStaticMarkup(
    <RoundPrep
      interviewId="i1"
      state={{ note: current, generatedAt: '2026-09-20T10:00:00Z', stale: false }}
      timezone="Europe/London"
    />,
  );
}

describe('RoundPrep', () => {
  it('folds a written note by its heading, open to begin with', () => {
    const html = render(note);
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toMatch(/<summary[^>]*>[\s\S]*Prep note[\s\S]*<\/summary>/);
    expect(html).toContain('A first round with the team lead.');
  });

  it('keeps Regenerate outside the summary', () => {
    const html = render(note);
    const summary = html.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? '';
    expect(summary).not.toContain('Regenerate');
    expect(html).toContain('Regenerate');
  });

  it('has nothing to fold before a note is written', () => {
    const html = render(null);
    expect(html).not.toContain('<details');
    expect(html).toContain('Prepare me');
  });
});
