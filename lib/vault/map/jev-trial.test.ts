import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAP_TRIAL_SIZE,
  onHaikuFailure,
  onJevFailure,
  pickMapTrialSample,
  referenceFor,
  summariseMapTrial,
  type MapTrialAnswer,
} from './jev-trial';

const md5 = (text: string) => createHash('md5').update(text).digest('hex');

describe('pickMapTrialSample', () => {
  const notes = Array.from({ length: 200 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    path: `Notes/${i}.md`,
  }));

  it('takes the 75 lowest md5(id || trial75), as the trial drew them', () => {
    const sample = pickMapTrialSample(notes);
    const expected = [...notes]
      .sort((a, b) => (md5(`${a.id}trial75`) < md5(`${b.id}trial75`) ? -1 : 1))
      .slice(0, MAP_TRIAL_SIZE);
    expect(sample).toEqual(expected);
  });

  it('leaves out the three notes the trial left out, whatever their hash', () => {
    const withJournal = [...notes, { id: notes[0].id.replace(/0$/, 'f'), path: 'Me/Journal.md' }];
    expect(pickMapTrialSample(withJournal).some((note) => note.path === 'Me/Journal.md')).toBe(false);
  });
});

describe('referenceFor', () => {
  it('reads the trial write-up: positions found, and evidence where it said so', () => {
    expect(referenceFor('Pending/Order Without Design.md')).toEqual({ reference: 'read', evidence: null });
    expect(referenceFor('Pending/WFH - Alexander Hamilton Case.md')).toEqual({ reference: 'read', evidence: true });
    expect(referenceFor('Bulk/Bulk - Wiki/Places/Dallas.md')).toEqual({ reference: null, evidence: null });
  });
});

describe('what a failure does to the run', () => {
  it('stops on a missing key or an empty Anthropic account, and retries the rest', () => {
    expect(onJevFailure({ reason: 'no-key', detail: '' })).toBe('stop');
    expect(onJevFailure({ reason: 'refused', detail: '401: bad key' })).toBe('stop');
    expect(onJevFailure({ reason: 'refused', detail: '422: too long' })).toBe('store');
    expect(onJevFailure({ reason: 'overloaded', detail: '529' })).toBe('retry');
    expect(onHaikuFailure('400 Your credit balance is too low to access the Anthropic API')).toBe('stop');
    expect(onHaikuFailure('overloaded_error')).toBe('retry');
  });
});

const row = (overrides: Partial<MapTrialAnswer>): MapTrialAnswer => ({
  note_id: 'n',
  path: 'Notes/n.md',
  not_sent: null,
  excluded: false,
  reference: null,
  reference_evidence: null,
  jev_class: 'knowledge',
  jev_confidence: 0.9,
  jev_evidence_probability: 0.1,
  jev_failure: null,
  haiku_class: 'knowledge',
  haiku_evidence: false,
  haiku_reason: 'Argues.',
  haiku_failure: null,
  ...overrides,
});

describe('summariseMapTrial', () => {
  it('scores both models, and the rollout, against the trial’s reference', () => {
    const summary = summariseMapTrial([
      row({ note_id: 'a', reference: 'read' }),
      // Jev sure and right where Haiku skipped a note the trial read.
      row({ note_id: 'b', reference: 'read', haiku_class: 'operational', haiku_reason: 'A list.' }),
      // Jev unsure and wrong: the rollout takes Haiku's answer.
      row({ note_id: 'c', reference: 'read', jev_class: 'operational', jev_confidence: '0.55' }),
      row({ note_id: 'd', jev_class: 'mixed', jev_confidence: 0.85, haiku_class: 'knowledge' }),
      row({ note_id: 'e', not_sent: 'too_short', jev_class: null, haiku_class: null }),
      row({ note_id: 'f', jev_class: null, jev_failure: 'refused: 422 too long' }),
      row({
        note_id: 'g',
        reference: 'read',
        reference_evidence: true,
        jev_evidence_probability: 0.7,
        haiku_evidence: false,
      }),
    ]);

    expect(summary.notSent).toEqual({ too_short: 1 });
    expect(summary.jevFailed).toEqual({ refused: 1 });
    expect(summary.compared).toBe(5);
    expect(summary.classAgree).toBe(2);
    expect(summary.routeAgree).toBe(3);
    expect(summary.unsure).toBe(1);
    expect(summary.sure).toEqual({ notes: 4, classAgree: 2, routeAgree: 3 });
    expect(summary.reference).toEqual({
      notes: 4,
      jevReads: 3,
      haikuReads: 3,
      rolloutReads: 4,
      evidenceNotes: 1,
      jevEvidence: 1,
      haikuEvidence: 0,
    });
    expect(summary.disagreements.map((d) => d.path && d.jev)).toEqual(['knowledge', 'mixed', 'operational']);
  });
});
