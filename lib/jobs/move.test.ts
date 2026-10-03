import { describe, expect, it } from 'vitest';
import { moveWord } from '@/lib/core/move';
import { applicationMove, lastTurnEvent } from './move';

const word = (input: Parameters<typeof applicationMove>[0]) => {
  const found = applicationMove(input);
  return found ? moveWord(found.move) : null;
};

describe('applicationMove', () => {
  const base = { companyName: 'EliseAI', lastEvent: null };

  it('says a sent application is waiting on the company', () => {
    expect(word({ ...base, status: 'submitted', lastEvent: 'submitted' })).toBe(
      'Waiting on EliseAI',
    );
    expect(word({ ...base, status: 'acknowledged', lastEvent: 'confirmation' })).toBe(
      'Waiting on EliseAI',
    );
    expect(word({ ...base, status: 'in_process', lastEvent: 'interview_completed' })).toBe(
      'Waiting on EliseAI',
    );
    expect(word({ ...base, status: 'final_round', lastEvent: 'follow_up_sent' })).toBe(
      'Waiting on EliseAI',
    );
  });

  it('puts it on you when you have not applied, or they last wrote', () => {
    expect(word({ ...base, status: 'lead' })).toBe('On you');
    expect(word({ ...base, status: 'drafting' })).toBe('On you');
    expect(word({ ...base, status: 'in_process', lastEvent: 'recruiter_reply' })).toBe('On you');
    expect(word({ ...base, status: 'in_process', lastEvent: 'assessment_sent' })).toBe('On you');
    expect(word({ ...base, status: 'final_round', lastEvent: 'interview_scheduled' })).toBe(
      'On you',
    );
    expect(word({ ...base, status: 'offer', lastEvent: 'offer' })).toBe('On you');
  });

  it('shows nothing once the application has closed', () => {
    for (const status of ['rejected', 'withdrawn', 'ghosted', 'role_closed'] as const) {
      expect(applicationMove({ ...base, status })).toBeNull();
    }
  });

  it('says bare Waiting when the company has no name', () => {
    expect(word({ status: 'submitted', lastEvent: null, companyName: ' ' })).toBe('Waiting');
  });
});

describe('lastTurnEvent', () => {
  it('skips notes and dragged cards', () => {
    expect(lastTurnEvent(['note', 'status_override', 'recruiter_reply', 'submitted'])).toBe(
      'recruiter_reply',
    );
    expect(lastTurnEvent(['note'])).toBeNull();
    expect(lastTurnEvent([])).toBeNull();
  });
});
