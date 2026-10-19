import { describe, expect, it } from 'vitest';
import { experienceAsk, experienceRange } from '@/lib/jobs/jd/experience';

const range = (text: string) => {
  const ask = experienceAsk(text);
  return ask ? experienceRange(ask) : null;
};

describe('experienceAsk', () => {
  it('reads the usual ways a posting writes years', () => {
    expect(range('- 5+ years in finance, including ownership of FP&A')).toBe('5+ years');
    expect(range('- 5-8 years in FP&A or strategic finance')).toBe('5–8 years');
    expect(range('5 to 8 years of experience in deal desk')).toBe('5–8 years');
    expect(range('• 1–3 years of experience in consulting')).toBe('1–3 years');
    expect(range('You have between 2 and 10 years of full-time work experience')).toBe('2–10 years');
    expect(range('Two or more years in management consulting')).toBe('2+ years');
    expect(range('Minimum of 2 years of investment banking')).toBe('2 years');
    expect(range('Need to have: ~1 year relevant experience (IB, corporate finance)')).toBe('1 year');
    expect(range('6-8+ years of work experience including FP&A')).toBe('6+ years');
    expect(range('Typically, 4-7 years years of experience in operations')).toBe('4–7 years');
  });

  it('takes the widest ask as the range and keeps every line that asks, cleaned', () => {
    const ask = experienceAsk(
      [
        'What you bring',
        '- 1-5 years of client-facing experience in investment banking',
        '- **5-10 years** of client-facing experience with an emphasis on relationships',
        '- Excellent written communication',
        '- 2 years in startups &amp; scale-ups',
      ].join('\n'),
    );
    expect(ask).toEqual({
      min: 5,
      max: 10,
      lines: [
        '1-5 years of client-facing experience in investment banking',
        '5-10 years of client-facing experience with an emphasis on relationships',
        '2 years in startups & scale-ups',
      ],
    });
  });

  it('leaves out the company talking about time', () => {
    expect(
      experienceAsk(
        [
          'We believe that in five years, more than 95% of legal work will be concentrated among a few firms.',
          'We have scaled to 170+ employees in under two years.',
          'We are 70 people and will reach 140 by the end of the year.',
          'Pay is $150,000 per year.',
          'Building on more than 30 years of investing experience, the firm seeks returns.',
          'Years of relevant experience are one factor in pay.',
        ].join('\n'),
      ),
    ).toBeNull();
    expect(experienceAsk(null)).toBeNull();
  });
});
