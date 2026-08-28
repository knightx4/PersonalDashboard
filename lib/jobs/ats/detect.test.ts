import { describe, expect, it } from 'vitest';
import { detectPosting, supportsQuestionFetch } from '@/lib/jobs/ats/detect';

describe('detectPosting', () => {
  it('reads a Greenhouse board token and job id', () => {
    expect(detectPosting('https://boards.greenhouse.io/ramp/jobs/4318822')).toMatchObject({
      vendor: 'greenhouse',
      boardToken: 'ramp',
      jobId: '4318822',
      tier: 1,
    });
  });

  it('reads the newer job-boards.greenhouse.io host', () => {
    expect(detectPosting('https://job-boards.greenhouse.io/linear/jobs/5512001')).toMatchObject({
      vendor: 'greenhouse',
      boardToken: 'linear',
      jobId: '5512001',
    });
  });

  it('reads a Greenhouse embedded board from the query string', () => {
    expect(
      detectPosting('https://boards.greenhouse.io/embed/job_app?for=ramp&token=4318822'),
    ).toMatchObject({ vendor: 'greenhouse', boardToken: 'ramp', jobId: '4318822' });
  });

  it('reads a Lever company and posting id', () => {
    expect(
      detectPosting('https://jobs.lever.co/figma/9f2c1a44-11ce-4a52-9b03-6b0c2e1f7c21'),
    ).toMatchObject({
      vendor: 'lever',
      boardToken: 'figma',
      jobId: '9f2c1a44-11ce-4a52-9b03-6b0c2e1f7c21',
      tier: 1,
    });
  });

  it('reads an Ashby board', () => {
    expect(detectPosting('https://jobs.ashbyhq.com/linear')).toMatchObject({
      vendor: 'ashby',
      boardToken: 'linear',
      tier: 1,
    });
  });

  it('reads a Workable shortcode', () => {
    expect(detectPosting('https://apply.workable.com/monzo/j/A1B2C3D4E5/')).toMatchObject({
      vendor: 'workable',
      boardToken: 'monzo',
      jobId: 'A1B2C3D4E5',
    });
  });

  it('sends a LinkedIn job page to the paste box with a reason', () => {
    const result = detectPosting('https://www.linkedin.com/jobs/view/3912345678/');
    expect(result.tier).toBe(3);
    expect(result.vendor).toBe('linkedin');
    expect(result.reason).toMatch(/paste/i);
  });

  it('sends Workday to the paste box with a reason', () => {
    const result = detectPosting(
      'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/New-York/Analyst_JR-284917',
    );
    expect(result.tier).toBe(3);
    expect(result.reason).toMatch(/paste/i);
  });

  it('treats an unknown careers page as tier 2 rather than giving up', () => {
    expect(detectPosting('https://ramp.com/careers/analyst')).toMatchObject({
      vendor: 'other',
      tier: 2,
    });
  });

  it('does not pretend a non-URL is a posting', () => {
    expect(detectPosting('not a url').tier).toBe(3);
  });
});

describe('supportsQuestionFetch', () => {
  it('is honest that only Greenhouse serves application questions', () => {
    expect(supportsQuestionFetch('greenhouse')).toBe(true);
    expect(supportsQuestionFetch('lever')).toBe(false);
    expect(supportsQuestionFetch('workday')).toBe(false);
  });
});
