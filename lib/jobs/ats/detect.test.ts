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

  it('reads a Workable board from the company subdomain', () => {
    expect(detectPosting('https://monzo.workable.com/j/A1B2C3D4E5')).toMatchObject({
      vendor: 'workable',
      boardToken: 'monzo',
      jobId: 'A1B2C3D4E5',
      tier: 1,
    });
  });

  it('reads a SmartRecruiters company and posting id', () => {
    expect(
      detectPosting('https://jobs.smartrecruiters.com/Ramp/743999123456789-staff-engineer'),
    ).toMatchObject({
      vendor: 'smartrecruiters',
      boardToken: 'Ramp',
      jobId: '743999123456789',
      tier: 1,
    });
  });

  it('leaves a SmartRecruiters board with no posting id at tier 2', () => {
    // The API is per-posting, so a bare board is the generic fetcher's problem.
    expect(detectPosting('https://careers.smartrecruiters.com/Ramp')).toMatchObject({
      vendor: 'smartrecruiters',
      tier: 2,
    });
  });

  it('reads a Recruitee offer slug', () => {
    expect(detectPosting('https://monzo.recruitee.com/o/staff-engineer-platform')).toMatchObject({
      vendor: 'recruitee',
      boardToken: 'monzo',
      jobId: 'staff-engineer-platform',
      tier: 1,
    });
  });

  it('reads a Breezy position id', () => {
    expect(detectPosting('https://acme.breezy.hr/p/a1b2c3d4e5f6-senior-engineer')).toMatchObject({
      vendor: 'breezy',
      boardToken: 'acme',
      jobId: 'a1b2c3d4e5f6',
      tier: 1,
    });
  });

  it('reads a BambooHR opening id', () => {
    expect(detectPosting('https://acme.bamboohr.com/careers/1234')).toMatchObject({
      vendor: 'bamboohr',
      boardToken: 'acme',
      jobId: '1234',
      tier: 1,
    });
  });

  it('reads a Rippling board and posting uuid', () => {
    expect(
      detectPosting('https://ats.rippling.com/acme/jobs/9f2c1a44-11ce-4a52-9b03-6b0c2e1f7c21'),
    ).toMatchObject({
      vendor: 'rippling',
      boardToken: 'acme',
      jobId: '9f2c1a44-11ce-4a52-9b03-6b0c2e1f7c21',
      tier: 1,
    });
  });

  it('does not mistake a vendor marketing page for a board', () => {
    // www.bamboohr.com is the product's own site, not somebody's careers page.
    expect(detectPosting('https://www.bamboohr.com/pricing')).toMatchObject({
      vendor: 'bamboohr',
      boardToken: null,
      jobId: null,
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
