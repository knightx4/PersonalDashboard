import { describe, expect, it } from 'vitest';
import { guessNewRole } from './new-role-guess';

describe('guessNewRole', () => {
  it('reads the employer and role from an ATS subject, not the tracker', () => {
    expect(
      guessNewRole({
        fromAddress: 'no-reply@greenhouse.io',
        subject: 'Your application to Tallow — Backend Engineer, Payments',
      }),
    ).toEqual({ company: 'Tallow', title: 'Backend Engineer, Payments' });
  });

  it('reads "role at company" from an ATS subject', () => {
    expect(
      guessNewRole({
        fromAddress: 'no-reply@greenhouse.io',
        subject: 'Re: Senior Designer at Monzo',
      }),
    ).toEqual({ company: 'Monzo', title: 'Senior Designer' });
  });

  it('leaves Company blank when an ATS subject names no employer', () => {
    expect(
      guessNewRole({ fromAddress: 'no-reply@greenhouse.io', subject: 'Following up' }),
    ).toEqual({ company: '', title: 'Following up' });
  });

  it('keeps the sender as the employer for mail that is not from an ATS', () => {
    expect(
      guessNewRole({
        fromAddress: '"Kestrel Bank" <talent@kestrelbank.example>',
        subject: 'Fwd: Platform Engineer',
      }),
    ).toEqual({ company: 'Kestrel Bank', title: 'Platform Engineer' });
  });
});
