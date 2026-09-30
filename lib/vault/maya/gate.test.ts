import { describe, expect, it } from 'vitest';
import type { JevResult, JevYesNoAnswer } from '@/lib/jev/wire';
import {
  gateRefusal,
  gateVerdict,
  MAYA_GATE_QUESTION,
  MAYA_GATE_SAMPLE_CHARS,
  MAYA_GATE_THRESHOLD,
  mayaGateState,
  passesGate,
} from '@/lib/vault/maya/gate';

const LONG = 'Why does money fail to measure value when values depend on each other? '.repeat(3);

function answered(probability: number): JevResult<JevYesNoAnswer> {
  return {
    ok: true,
    model: 'jev-1.13.0',
    answer: { type: 'yes-no', yes: probability >= 0.5, probability, confidence: Math.abs(2 * probability - 1) },
  };
}

describe('the gate question', () => {
  it('is a yes/no question with both meanings written', () => {
    expect(MAYA_GATE_QUESTION.type).toBe('yes-no');
    expect(MAYA_GATE_QUESTION.yes.length).toBeGreaterThan(0);
    expect(MAYA_GATE_QUESTION.no.length).toBeGreaterThan(0);
  });

  it('is set to the line the trial chose', () => {
    expect(MAYA_GATE_THRESHOLD).toBe(0.95);
  });
});

describe('gateRefusal', () => {
  it('refuses what the map refuses', () => {
    expect(gateRefusal({ path: 'Me/Thoughts.md', body: LONG })?.reason).toBe('journal');
    expect(gateRefusal({ path: 'Career/Job Applications/Acme.md', body: LONG })?.reason).toBe('excluded');
    expect(gateRefusal({ path: 'Ideas/Keys.md', body: `${LONG} sk-ant-abc123` })?.reason).toBe('credential');
  });

  it('refuses a note too short to hold a question', () => {
    expect(gateRefusal({ path: 'Ideas/Short.md', body: 'Why?' })?.reason).toBe('too-short');
  });

  it('lets an ordinary note through', () => {
    expect(gateRefusal({ path: 'Pending/Money.md', body: LONG })).toBeNull();
  });
});

describe('mayaGateState', () => {
  it('sends the title and the opening of the body, never the path', () => {
    const state = mayaGateState({ title: 'Money', body: `  ${'x'.repeat(MAYA_GATE_SAMPLE_CHARS + 50)}  ` });
    expect(Object.keys(state).sort()).toEqual(['text', 'title']);
    expect(state.text).toHaveLength(MAYA_GATE_SAMPLE_CHARS);
    expect(JSON.stringify(state)).not.toContain('Pending/');
  });
});

describe('gateVerdict', () => {
  it('passes at or above the line and skips below it', () => {
    expect(passesGate(MAYA_GATE_THRESHOLD)).toBe(true);
    expect(gateVerdict(answered(0.97), true)).toMatchObject({
      passes: true,
      outcome: 'thought',
      probability: 0.97,
      jevModel: 'jev-1.13.0',
    });
    expect(gateVerdict(answered(0.94), true)).toMatchObject({ passes: false, outcome: 'skip', probability: 0.94 });
  });

  it('never passes when Jev is off for the account, even on a sure answer', () => {
    expect(gateVerdict(answered(0.99), false)).toMatchObject({ passes: false, outcome: 'not_enabled', probability: null });
  });

  it('never passes when Jev failed or was not asked', () => {
    expect(gateVerdict({ ok: false, reason: 'no-key', detail: 'TYPESAFE_API_KEY is not set' }, true)).toMatchObject({
      passes: false,
      outcome: 'failed',
      failure: 'no-key: TYPESAFE_API_KEY is not set',
    });
    expect(gateVerdict(null, true)).toMatchObject({ passes: false, outcome: 'failed' });
  });

  it('does not pass a probability that is not a number', () => {
    expect(passesGate(Number.NaN)).toBe(false);
  });
});
