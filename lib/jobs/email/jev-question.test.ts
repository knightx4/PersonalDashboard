import { describe, expect, it } from 'vitest';
import { CLASSIFICATIONS } from './classify';
import { isJobEmailLabel, JEV_BODY_CHARS, JOB_EMAIL_QUESTION, jobEmailState } from './jev-question';

describe('the job-email question for Jev', () => {
  it('offers every classification Haiku picks from, plus other', () => {
    expect(Object.keys(JOB_EMAIL_QUESTION.options).sort()).toEqual([...CLASSIFICATIONS, 'other'].sort());
    for (const meaning of Object.values(JOB_EMAIL_QUESTION.options)) expect(meaning.length).toBeGreaterThan(10);
  });

  it('reads the same text Haiku reads, cut at the same length', () => {
    const state = jobEmailState({
      fromAddress: null,
      replyToAddress: null,
      subject: null,
      body: 'x'.repeat(JEV_BODY_CHARS + 50),
    });
    expect(state).toMatchObject({ from: 'unknown', reply_to: 'none', subject: '(no subject)' });
    expect(state.body).toHaveLength(JEV_BODY_CHARS);
  });

  it('knows its labels', () => {
    expect(isJobEmailLabel('other')).toBe(true);
    expect(isJobEmailLabel('rejection')).toBe(true);
    expect(isJobEmailLabel('spam')).toBe(false);
  });
});
