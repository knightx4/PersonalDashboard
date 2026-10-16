import { describe, expect, it } from 'vitest';
import { casePrompt } from '@/lib/learn/levels/case-call';
import { bestLine, cosine, roleLinesFrom, roleSituation, roleWhy, type RoleLine } from '@/lib/learn/levels/role-line';

const role: RoleLine = { roleId: 'r1', roleTitle: 'FP&A Manager', company: 'Acme', line: 'Build driver-based forecasts' };

describe('roleLinesFrom', () => {
  it('keeps must-haves and nice-to-haves once and drops responsibilities', () => {
    const lines = roleLinesFrom([
      {
        id: 'r1',
        title: 'FP&A Manager',
        company: { name: 'Acme' },
        requirements: [
          { text: 'Build driver-based forecasts', kind: 'must_have' },
          { text: 'Run the monthly close', kind: 'responsibility' },
          { text: 'SQL', kind: 'nice_to_have' },
        ],
      },
      { id: 'r2', title: 'Analyst', company: null, requirements: [{ text: 'build driver-based forecasts', kind: 'must_have' }] },
      { id: 'r3', title: 'None', company: null, requirements: null },
    ]);
    expect(lines.map((l) => l.line)).toEqual(['Build driver-based forecasts', 'SQL']);
    expect(lines[0]).toMatchObject({ roleId: 'r1', company: 'Acme' });
  });
});

describe('bestLine', () => {
  const near = { vector: [1, 0.1], line: role };
  const far = { vector: [0, 1], line: { ...role, roleId: 'r2' } };
  it('picks the closest line over the threshold', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(bestLine([1, 0], [far, near])?.roleId).toBe('r1');
  });
  it('returns null when nothing is close enough', () => {
    expect(bestLine([1, 0], [far])).toBeNull();
    expect(bestLine([1, 0], [])).toBeNull();
  });
});

describe('sentences', () => {
  it('names the role in the why line', () => {
    expect(roleWhy(role)).toBe('Asked for in the FP&A Manager role at Acme: “Build driver-based forecasts”');
    expect(roleWhy({ ...role, company: null })).toContain('FP&A Manager role:');
  });
  it('sets the case in the posting', () => {
    expect(roleSituation(role).join(' ')).toContain('Build driver-based forecasts');
    const text = casePrompt({ topicName: 'Forecasting', level: 4, descriptor: ['a'], asked: [], role });
    expect(text).toContain('FP&A Manager role at Acme');
    expect(casePrompt({ topicName: 'Forecasting', level: 4, descriptor: ['a'], asked: [] })).not.toContain('posting');
  });
});
