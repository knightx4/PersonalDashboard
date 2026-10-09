import { describe, expect, it } from 'vitest';
import { chanceText, parseScoreMinimum, passesMinimum, scoreNote, type ScoreNote } from './score-notes';

const input = {
  kind: 'application' as const,
  title: 'Senior Financial Analyst',
  scores: { fit_score: { value: 64, confidence: 0.3 }, chance: { value: 30, confidence: 0.9 } },
  history: [],
  hasDescription: true,
};

describe('scoreNote', () => {
  it('gives fit as a figure and chance as its band, each with a reason and marked unsure under the floor', () => {
    const note = scoreNote(input)!;
    expect(note.fit).toMatchObject({ value: 64, unsure: true });
    expect(note.fit?.reason).toBeTruthy();
    expect(note.chance).toMatchObject({ value: 30, band: 'medium', unsure: false });
    expect(chanceText(note.chance!)).toBe('30');
    expect(note.chance?.reason).toBe('No past applications to compare against yet');
  });

  it('leaves chance out once the application has reached an interview', () => {
    expect(scoreNote(input, { interviewed: true })?.chance).toBeNull();
  });

  it('is null with neither figure', () => {
    expect(scoreNote({ ...input, scores: {} })).toBeNull();
  });
});

describe('the minimums', () => {
  const note: ScoreNote = {
    fit: { value: 55, unsure: false, reason: null },
    chance: { value: 20, band: 'low', unsure: false, reason: null },
  };

  it('reads only the offered values off the URL', () => {
    expect(parseScoreMinimum({ minfit: '60', minchance: 'high' })).toEqual({ fit: 60, chance: 'high' });
    expect(parseScoreMinimum({ minfit: '55', minchance: 'huge' })).toEqual({ fit: 0, chance: 'any' });
  });

  it('hides a row under either minimum and passes a row with no note', () => {
    expect(passesMinimum(note, { fit: 50, chance: 'any' })).toBe(true);
    expect(passesMinimum(note, { fit: 60, chance: 'any' })).toBe(false);
    expect(passesMinimum(note, { fit: 0, chance: 'medium' })).toBe(false);
    expect(passesMinimum(null, { fit: 70, chance: 'high' })).toBe(true);
    expect(passesMinimum({ ...note, chance: null }, { fit: 0, chance: 'high' })).toBe(true);
  });
});
