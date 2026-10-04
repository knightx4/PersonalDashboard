import { describe, expect, it } from 'vitest';
import { channelForMessage } from './channel';

describe('channelForMessage', () => {
  it('calls it recruiter inbound only when the recruiter wrote first', () => {
    expect(channelForMessage('recruiter_outreach')).toBe('recruiter_inbound');
  });

  it('calls everything else a portal application', () => {
    for (const classification of ['interview_invite', 'scheduling', 'rejection', 'recruiter_reply', null]) {
      expect(channelForMessage(classification)).toBe('portal');
    }
  });
});
