import { describe, expect, it } from 'vitest';
import {
  criticStopAsk,
  criticStopBlockSql,
  isCriticStopAsk,
  isStopRound,
  STOP_ASK_ENDING,
  stoppedSurfaces,
  acceptedLine,
  acceptedRounds,
  criticStopNeeds,
  readStopFixes,
  shotName,
  stopBranch,
  type StopRound,
  surfaceLabels,
  surfaceLink,
} from './ui-check-stop';

const fix = (surface: string, round: number, fixes = 2, shots: string[] = []): StopRound => ({
  surface,
  round,
  verdict: 'fix',
  fixes: Array.from({ length: fixes }, () => ({})),
  shots,
});

describe('isStopRound', () => {
  it('stops on 3, and on 6 and 9 after a redirect', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(isStopRound)).toEqual([false, false, true, false, false, true, true]);
  });
});

describe('stoppedSurfaces', () => {
  it('names a surface whose round 3 asked for fixes', () => {
    const out = stoppedSurfaces([fix('jobs-contact', 1), fix('jobs-contact', 2), fix('jobs-contact', 3, 4, ['a.png'])]);
    expect(out).toEqual([{ surface: 'jobs-contact', round: 3, fixes: 4, uploaded: true }]);
  });

  it('leaves out a surface that passed, and one still inside its rounds', () => {
    const out = stoppedSurfaces([
      fix('a', 3),
      { surface: 'a', round: 4, verdict: 'pass', fixes: [], shots: [] },
      fix('b', 2),
      fix('c', 3, 1),
    ]);
    expect(out.map((s) => s.surface)).toEqual(['c']);
  });

  it('takes a count of fixes as given', () => {
    expect(stoppedSurfaces([{ surface: 'x', round: 6, verdict: 'fix', fixes: 5, shots: [] }])[0].fixes).toBe(5);
  });
});

describe('criticStopAsk', () => {
  const ask = criticStopAsk({
    owner: 1609,
    branch: 'claude/x',
    surfaces: [
      { surface: 'jobs-contact', round: 3, fixes: 1, uploaded: true, label: 'Jobs · a contact' },
      { surface: 'plan-row', round: 3, fixes: 3, uploaded: false },
    ],
  });

  it('names each surface as the gallery does, with its link, its fixes, where its shots are and the branch', () => {
    expect(ask).toContain('#1609');
    expect(ask).toContain(
      'Jobs · a contact (jobs-contact), in the gallery at /preview?s=jobs-contact, after round 3 (1 fix open, shots in ui-shots under 1609/jobs-contact/r3)',
    );
    expect(ask).toContain(
      'plan-row, in the gallery at /preview?s=plan-row, after round 3 (3 fixes open, shots not uploaded',
    );
    expect(ask).toContain('branch claude/x');
    expect(ask.endsWith(STOP_ASK_ENDING)).toBe(true);
  });

  it('is recognised, and another ask is not', () => {
    expect(isCriticStopAsk(ask)).toBe(true);
    expect(isCriticStopAsk('Which of the options on #12?')).toBe(false);
    expect(isCriticStopAsk(null)).toBe(false);
  });

  it('names a note by its id', () => {
    const note = criticStopAsk({
      owner: '0b6f0f5e-1111-4222-8333-944444444444',
      branch: 'b',
      surfaces: [{ surface: 's', round: 3, fixes: 1, uploaded: false }],
    });
    expect(note).toContain('note 0b6f0f5e-1111-4222-8333-944444444444');
  });

  it('refuses with no surface or no branch', () => {
    expect(() => criticStopAsk({ owner: 1, branch: 'b', surfaces: [] })).toThrow();
    expect(() =>
      criticStopAsk({ owner: 1, branch: ' ', surfaces: [{ surface: 's', round: 3, fixes: 1, uploaded: false }] }),
    ).toThrow();
  });
});

describe('criticStopBlockSql', () => {
  it('blocks on the person with the ask, and records it', () => {
    const sql = criticStopBlockSql({ step: 1609, ask: "#1609's screen", date: '2026-10-04' });
    expect(sql).toContain("status = 'blocked', block_ask = $a$#1609's screen$a$, block_kind = 'outside'");
    expect(sql).toContain('Blocked 2026-10-04: #1609');
    expect(sql).toContain('core.dash_before(');
    expect(sql).toContain("'block_step'");
  });

  it('refuses a bad date or user id', () => {
    expect(() => criticStopBlockSql({ step: 1, ask: 'a', date: 'today' })).toThrow();
    expect(() => criticStopBlockSql({ step: 1, ask: 'a', date: '2026-10-04', userId: 'x' })).toThrow();
  });
});

describe('accepting a stopped screen (plan #1610)', () => {
  const ask = criticStopAsk({
    owner: 1612,
    branch: 'claude/contact-card',
    surfaces: [{ surface: 'jobs-contact', round: 3, fixes: 2, uploaded: false }],
  });

  it('reads the branch back out of the ask', () => {
    expect(stopBranch(ask)).toBe('claude/contact-card');
    expect(stopBranch('Something else.')).toBeNull();
    expect(stopBranch(null)).toBeNull();
  });

  it('writes the accepted round as the next one, so it is the latest', () => {
    expect(acceptedRounds([{ surface: 'jobs-contact', round: 3 }])).toEqual([
      { surface: 'jobs-contact', round: 4, verdict: 'accepted' },
    ]);
  });

  it('a surface accepted after its stop is no longer stopped', () => {
    expect(
      stoppedSurfaces([
        fix('jobs-contact', 3),
        { surface: 'jobs-contact', round: 4, verdict: 'accepted', fixes: [], shots: [] },
      ]),
    ).toEqual([]);
  });

  it('says on the history which branch to merge', () => {
    const line = acceptedLine({ date: '2026-10-04', surfaces: ['jobs-contact'], branch: 'claude/x' });
    expect(line).toMatch(/^Accepted 2026-10-04: /);
    expect(line).toContain('jobs-contact');
    expect(line).toContain('branch claude/x: merge it and close the step.');
  });

  it('shortens the Needs line to what the panel does not say', () => {
    expect(criticStopNeeds('claude/x')).toBe(
      'Your call on a screen the design critic would not pass. The work is on branch claude/x.',
    );
    expect(criticStopNeeds(null)).not.toContain('branch');
  });

  it('keeps the readable fixes and names the shots', () => {
    expect(
      readStopFixes([{ shot: 'phone-light', where: 'top', problem: 'Crowded', breaks: 'law 9', change: 'Fold it' }, 4, {}]),
    ).toEqual([{ shot: 'phone-light', where: 'top', problem: 'Crowded', breaks: 'law 9', change: 'Fold it' }]);
    expect(readStopFixes(null)).toEqual([]);
    expect(shotName('u/1612/jobs-contact/r3/laptop-dark.png')).toBe('laptop-dark');
  });
});

describe('surfaceLabels', () => {
  it("reads each entry's label after its id, in either quote", () => {
    const source = [
      '  {',
      "    id: 'goals-home',",
      "    label: 'Goals · home',",
      '  },',
      '  {',
      "    id: 'learn-now-deck',",
      '    label: "Learn now · the deck",',
      '  },',
      "  { id: 'g2', name: 'not a surface' },",
    ].join('\n');
    const labels = surfaceLabels(source);
    expect(labels.get('goals-home')).toBe('Goals · home');
    expect(labels.get('learn-now-deck')).toBe('Learn now · the deck');
    expect(labels.has('g2')).toBe(false);
  });

  it('links a surface in the gallery', () => {
    expect(surfaceLink('goals-home')).toBe('/preview?s=goals-home');
  });
});
