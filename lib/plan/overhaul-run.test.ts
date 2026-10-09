import { describe, expect, it } from 'vitest';
import { overhaulRefusal, overhaulTurn } from './overhaul-run';

const set = { id: true, token: true };
const overhaul = { number: 1510, track: 'overhaul', status: 'not_started' } as const;

describe('overhaulRefusal', () => {
  it('lets an open overhaul with the routine set up start', () => {
    expect(overhaulRefusal(overhaul, set, null)).toBeNull();
    expect(overhaulRefusal(overhaul, set, { status: 'finished', job: 'overhaul' })).toBeNull();
  });

  it('refuses a feature that is not an overhaul', () => {
    expect(overhaulRefusal({ ...overhaul, track: 'feature' }, set, null)).toMatch(/not an overhaul/);
  });

  it('refuses a proposal and a closed overhaul', () => {
    expect(overhaulRefusal({ ...overhaul, status: 'proposed' }, set, null)).toMatch(/proposal/);
    expect(overhaulRefusal({ ...overhaul, status: 'done' }, set, null)).toMatch(/nothing left/);
  });

  it('names exactly the variables the deployment is missing', () => {
    const neither = overhaulRefusal(overhaul, { id: false, token: false }, null);
    expect(neither).toContain('CLAUDE_OVERHAUL_ROUTINE_ID and CLAUDE_OVERHAUL_ROUTINE_TOKEN');
    const token = overhaulRefusal(overhaul, { id: true, token: false }, null);
    expect(token).toContain('CLAUDE_OVERHAUL_ROUTINE_TOKEN');
    expect(token).not.toContain('CLAUDE_OVERHAUL_ROUTINE_ID');
  });

  it('refuses while a run is already working the row', () => {
    expect(overhaulRefusal(overhaul, set, { status: 'started', job: 'overhaul' })).toMatch(
      /already working #1510/,
    );
    expect(overhaulRefusal(overhaul, set, { status: 'started', job: 'reshape' })).toMatch(
      /already working #1510/,
    );
  });
});

describe('overhaulTurn', () => {
  it('names the overhaul by number, the account and the brief', () => {
    const turn = overhaulTurn(
      { number: 1510, title: 'Build overhauls in their own order' },
      'user-1',
      '## Brief',
    );
    expect(turn).toMatch(/^Work overhaul #1510, "Build overhauls in their own order"\./);
    expect(turn).toContain('user_id: user-1');
    expect(turn.endsWith('## Brief')).toBe(true);
  });
});
