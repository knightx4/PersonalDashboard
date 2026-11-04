import { describe, expect, it } from 'vitest';
import { firstLineOf, isRoleLine, isSectionHeader, splitResume } from './resume-passages';

const RESUME = [
  'ALEX RIVERA',
  'Tel: (555) 000-0000 | Email: alex@example.com | Denver, CO',
  'EDUCATION',
  'RIVERSIDE SCHOOL OF MANAGEMENT Master of Business Administration (MBA) • Peer Tutor: Statistics, Economics',
  '• Teaching Assistant: Operations Management',
  'Portland, OR',
  '2024 - 2026',
  'STATE UNIVERSITY Boise, ID',
  'Master of Science in Accounting 2016 - 2020',
  "• Dean's List: six semesters",
  'PROFESSIONAL EXPERIENCE',
  'ACME AUDIT Denver, CO',
  'Assurance Senior 2020 - 2023',
  '• Wrote a reconciliation workbook that matched inventory counts to the ledger for twelve warehouses,',
  'replacing a week of manual tie-outs each quarter with one afternoon of review',
  "• Documented 15 purchasing controls for a client's first internal controls review.",
  'SELECTED PROJECTS',
  '• Bakery Budget Model: Monthly spending and sales model built for a family-run bakery.',
  'Built-in scenario tables show how many months of cash remain under three levels of sales.',
].join('\r\n');

describe('splitting a résumé into passages', () => {
  const passages = splitResume(RESUME);

  it('makes one passage per bullet and none for the name and contact lines', () => {
    expect(passages.map((p) => p.first_line)).toEqual([
      'Peer Tutor: Statistics, Economics',
      'Teaching Assistant: Operations Management',
      "Dean's List: six semesters",
      'Wrote a reconciliation workbook that matched inventory counts to the ledger for twelve warehouses, replacing a week of…',
      "Documented 15 purchasing controls for a client's first internal controls review.",
      'Bakery Budget Model: Monthly spending and sales model built for a family-run bakery. Built-in scenario tables show how…',
    ]);
    expect(passages.some((p) => p.body.includes('Email'))).toBe(false);
  });

  it('joins a wrapped bullet and puts its section and role in front of it', () => {
    const revenue = passages[3];
    expect(revenue.body).toBe(
      [
        'PROFESSIONAL EXPERIENCE',
        'ACME AUDIT Denver, CO',
        'Assurance Senior 2020 - 2023',
        'Wrote a reconciliation workbook that matched inventory counts to the ledger for twelve warehouses, replacing a week of manual tie-outs each quarter with one afternoon of review',
      ].join('\n'),
    );
  });

  it('keeps the role lines for every bullet under the role', () => {
    expect(passages[4].body).toContain('Assurance Senior 2020 - 2023');
    expect(passages[0].body).toContain('RIVERSIDE SCHOOL OF MANAGEMENT');
  });

  it('starts a new entry at a name in capitals, leaving the last one\'s place and dates behind', () => {
    expect(passages[2].body).toBe(
      ['EDUCATION', 'STATE UNIVERSITY Boise, ID', 'Master of Science in Accounting 2016 - 2020', "Dean's List: six semesters"].join('\n'),
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
    expect(isSectionHeader('ACME AUDIT Denver, CO')).toBe(false);
  });

  it('knows a role line by its dates or place', () => {
    expect(isRoleLine('Assurance Senior 2020 - 2023')).toBe(true);
    expect(isRoleLine('Portland, OR')).toBe(true);
    expect(isRoleLine('of recognized revenue, cutting testing time')).toBe(false);
  });

  it('cuts a long first line at 120 characters', () => {
    expect(firstLineOf('a'.repeat(200))).toHaveLength(120);
  });
});
