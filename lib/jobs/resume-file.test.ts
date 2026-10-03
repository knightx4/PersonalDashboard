import { describe, expect, it } from 'vitest';
import { ownsResumePath, resumeFileProblem, resumePath } from './resume-file';

const USER = '11111111-2222-3333-4444-555555555555';
const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('resume file paths', () => {
  it('owns a path it made', () => {
    expect(ownsResumePath(USER, resumePath(USER, FILE))).toBe(true);
  });

  it('refuses another folder, or a path that climbs out of its own', () => {
    expect(ownsResumePath(USER, resumePath('99999999-2222-3333-4444-555555555555', FILE))).toBe(false);
    expect(ownsResumePath(USER, `${USER}/resumes/../other.pdf`)).toBe(false);
    expect(ownsResumePath(USER, `${USER}/${FILE}.pdf`)).toBe(false);
  });
});

describe('resumeFileProblem', () => {
  it('keeps a PDF', () => {
    expect(resumeFileProblem({ name: 'cv.pdf', type: 'application/pdf', size: 120_000 })).toBeNull();
  });

  it('refuses anything else, an empty file, or one over the limit', () => {
    expect(resumeFileProblem({ name: 'cv.docx', type: 'application/msword', size: 10 })).toBe('Pick a PDF.');
    expect(resumeFileProblem({ name: 'cv.pdf', type: 'application/pdf', size: 0 })).toBe('That file is empty.');
    expect(resumeFileProblem({ name: 'cv.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).toMatch(/over 10 MB/);
  });
});
