import { describe, expect, it } from 'vitest';
import { startingInterviewKind } from './interview-kinds';

const at = (kind: string, scheduledAt: string | null) => ({ kind, scheduledAt });

describe('startingInterviewKind', () => {
  it('starts a first interview on the recruiter screen', () => {
    expect(startingInterviewKind([], [])).toBe('recruiter_screen');
  });

  it('matches the round it is added to', () => {
    const round = [at('technical', '2026-09-10T10:00:00Z'), at('panel', '2026-09-11T10:00:00Z')];
    expect(startingInterviewKind(round, round)).toBe('panel');
  });

  it('moves one step past the pursuit’s latest interview', () => {
    const pursuit = [
      at('recruiter_screen', '2026-09-01T10:00:00Z'),
      at('hiring_manager', '2026-09-05T10:00:00Z'),
    ];
    expect(startingInterviewKind([], pursuit)).toBe('technical');
  });

  it('ignores informal chats and stops at final', () => {
    expect(startingInterviewKind([], [at('informal', '2026-09-01T10:00:00Z')])).toBe(
      'recruiter_screen',
    );
    expect(startingInterviewKind([], [at('final', '2026-09-01T10:00:00Z')])).toBe('final');
  });

  it('treats an unscheduled interview as the latest', () => {
    const pursuit = [at('case', null), at('technical', '2026-09-20T10:00:00Z')];
    expect(startingInterviewKind([], pursuit)).toBe('panel');
  });
});
