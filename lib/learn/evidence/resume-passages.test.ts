import { describe, expect, it } from 'vitest';
import { firstLineOf, isRoleLine, isSectionHeader, splitResume } from './resume-passages';

const RESUME = [
  'ALEX EXAMPLE',
  'Tel: (555) 000-0000 | Email: alex@example.com | New York, NY',
  'EDUCATION',
  'NORTHFIELD SCHOOL OF MANAGEMENT Master of Business Administration (MBA) • Tutor: Accounting, Finance',
  '• Teaching Assistant: Global Macroeconomy',
  'New Haven, CT',
  '2024 - 2026',
  'SOUTHWEST UNIVERSITY Waco, TX',
  'Master of Accountancy 2016 - 2020',
  '• GPA: 4.0 / 4.0',
  'PROFESSIONAL EXPERIENCE',
  'ACME AUDIT Dallas, TX',
  'Assurance Senior 2020 - 2023',
  '• Built an automated revenue testing system from scratch that replaced manual sampling across 100%',
  'of recognized revenue, cutting testing time from hours to seconds',
  '• Assessed 10+ financial reporting processes for a first SOX implementation.',
  'SELECTED PROJECTS',
  '• Cash Flow Forecasting Platform: Rolling 90-day cash forecast model built for a small company.',
  'Built-in Monte Carlo simulation quantifies the probability of falling below a threshold.',
].join('\r\n');

describe('splitting a résumé into passages', () => {
  const passages = splitResume(RESUME);

  it('makes one passage per bullet and none for the name and contact lines', () => {
    expect(passages.map((p) => p.first_line)).toEqual([
      'Tutor: Accounting, Finance',
      'Teaching Assistant: Global Macroeconomy',
      'GPA: 4.0 / 4.0',
      'Built an automated revenue testing system from scratch that replaced manual sampling across 100% of recognized revenue,…',
      'Assessed 10+ financial reporting processes for a first SOX implementation.',
      'Cash Flow Forecasting Platform: Rolling 90-day cash forecast model built for a small company. Built-in Monte Carlo simu…',
    ]);
    expect(passages.some((p) => p.body.includes('Email'))).toBe(false);
  });

  it('joins a wrapped bullet and puts its section and role in front of it', () => {
    const revenue = passages[3];
    expect(revenue.body).toBe(
      [
        'PROFESSIONAL EXPERIENCE',
        'ACME AUDIT Dallas, TX',
        'Assurance Senior 2020 - 2023',
        'Built an automated revenue testing system from scratch that replaced manual sampling across 100% of recognized revenue, cutting testing time from hours to seconds',
      ].join('\n'),
    );
  });

  it('keeps the role lines for every bullet under the role', () => {
    expect(passages[4].body).toContain('Assurance Senior 2020 - 2023');
    expect(passages[0].body).toContain('NORTHFIELD SCHOOL OF MANAGEMENT');
  });

  it('starts a new entry at a name in capitals, leaving the last one\'s place and dates behind', () => {
    expect(passages[2].body).toBe(
      ['EDUCATION', 'SOUTHWEST UNIVERSITY Waco, TX', 'Master of Accountancy 2016 - 2020', 'GPA: 4.0 / 4.0'].join('\n'),
    );
  });

  it('numbers the passages in order and hashes each body', () => {
    expect(passages.map((p) => p.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(passages.map((p) => p.text_hash)).size).toBe(passages.length);
    expect(splitResume(RESUME)[3].text_hash).toBe(passages[3].text_hash);
  });

  it('finds nothing in an empty résumé', () => {
    expect(splitResume('')).toEqual([]);
  });
});

describe('reading a résumé line', () => {
  it('knows a section name from a line in capitals', () => {
    expect(isSectionHeader('PROFESSIONAL EXPERIENCE')).toBe(true);
    expect(isSectionHeader('EY Dallas, TX')).toBe(false);
  });

  it('knows a role line by its dates or place', () => {
    expect(isRoleLine('Assurance Senior 2020 - 2023')).toBe(true);
    expect(isRoleLine('New Haven, CT')).toBe(true);
    expect(isRoleLine('of recognized revenue, cutting testing time')).toBe(false);
  });

  it('cuts a long first line at 120 characters', () => {
    expect(firstLineOf('a'.repeat(200))).toHaveLength(120);
  });
});
