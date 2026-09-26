import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_ROLE_TITLE } from '@/lib/jobs/inbox/ingest-messages';
import {
  FIRST_SECTION_MAX_CHARS,
  PLACEHOLDER_TITLE,
  firstSection,
  pursuitMatchText,
} from './related-notes';

const long = (word: string, n: number) => Array.from({ length: n }, () => word).join(' ');

describe('firstSection', () => {
  it('is empty without a description', () => {
    expect(firstSection(null)).toBe('');
    expect(firstSection('')).toBe('');
  });

  it('skips headings and stops once the opening is long enough', () => {
    const about = `Galaxy is ${long('digital', 50)}.`;
    const text = `Who We Are:\n\n${about}\n\nWhat We Value:\n\n${long('value', 80)}`;
    expect(firstSection(text)).toBe(about);
  });

  it('joins short paragraphs until there is enough', () => {
    const a = `A company that ${long('builds', 10)}.`;
    const b = `The role ${long('owns', 60)}.`;
    expect(firstSection(`${a}\n\n${b}\n\n${long('perk', 80)}`)).toBe(`${a}\n${b}`);
  });

  it('cuts a description with no paragraph breaks', () => {
    const text = long('finance', 400);
    expect(firstSection(text).length).toBeLessThanOrEqual(FIRST_SECTION_MAX_CHARS);
  });
});

describe('pursuitMatchText', () => {
  it('names the company, the role and the opening', () => {
    const jd = `Array is ${long('fintech', 60)}.`;
    expect(pursuitMatchText({ company: 'Array', title: 'FP&A Analyst', jdText: jd })).toBe(
      `Array\nFP&A Analyst\n${jd}`,
    );
  });

  it('is empty without a description, so nothing is looked up', () => {
    expect(pursuitMatchText({ company: 'Google', title: 'Analyst', jdText: null })).toBe('');
    expect(pursuitMatchText({ company: 'Google', title: 'Analyst', jdText: 'About the job' })).toBe(
      '',
    );
  });

  it('leaves out the placeholder title', () => {
    const jd = `Google is ${long('search', 60)}.`;
    expect(pursuitMatchText({ company: 'Google', title: 'Role from email', jdText: jd })).toBe(
      `Google\n${jd}`,
    );
  });

  it('agrees with ingestion on the placeholder', () => {
    expect(PLACEHOLDER_TITLE).toBe(PLACEHOLDER_ROLE_TITLE);
  });
});
