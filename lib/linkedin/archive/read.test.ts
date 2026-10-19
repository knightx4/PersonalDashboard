import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseInstant, parsePartialDate } from './dates';
import { jobIdFromUrl, profileSlugFromUrl, rowHash } from './keys';
import { readLinkedInArchive, specFor, splitAnswers } from './read';
import type { ArchiveKind } from './types';

// The fixture is synthetic (fixtures/build-export.ts writes it); no test here
// reads a real export.
const ZIP = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'export.zip')));
const archive = readLinkedInArchive(ZIP);

describe('dates', () => {
  it('reads each of the export formats', () => {
    expect(parseInstant('6/13/26, 11:26 PM')).toBe('2026-06-13T23:26:00.000Z');
    expect(parseInstant('1/2/26, 12:05 AM')).toBe('2026-01-02T00:05:00.000Z');
    expect(parseInstant('12/1/25, 12:40 PM')).toBe('2025-12-01T12:40:00.000Z');
    expect(parseInstant('Fri Aug 21 19:02:55 UTC 2026')).toBe('2026-08-21T19:02:55.000Z');
    expect(parseInstant('2026-08-21 15:14:57 UTC')).toBe('2026-08-21T15:14:57.000Z');
    expect(parseInstant('2026-07-02 18:40 UTC')).toBe('2026-07-02T18:40:00.000Z');
    expect(parsePartialDate('Jul 2025')).toBe('2025-07');
    expect(parsePartialDate('2016')).toBe('2016');
    expect(parsePartialDate('21 Aug 2026')).toBe('2026-08-21');
  });

  it('returns null for empty and unreadable cells, never a guess', () => {
    expect(parseInstant('')).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant('2/30/26, 1:00 PM')).toBeNull();
    expect(parseInstant('13:00 yesterday')).toBeNull();
    expect(parsePartialDate('Smarch 2025')).toBeNull();
    expect(parsePartialDate('')).toBeNull();
  });
});

describe('keys', () => {
  it('takes the job id from a job URL', () => {
    expect(jobIdFromUrl('https://www.linkedin.com/jobs/view/4012345678')).toBe('4012345678');
    expect(jobIdFromUrl('http://www.linkedin.com/jobs/view/3999999999/')).toBe('3999999999');
    expect(jobIdFromUrl('https://www.linkedin.com/jobs/view/product-manager-at-acme-4012345678/')).toBe('4012345678');
    expect(jobIdFromUrl('https://www.linkedin.com/jobs/search/?currentJobId=4012345678')).toBe('4012345678');
    expect(jobIdFromUrl('https://example.com/jobs/1')).toBeNull();
  });

  it('takes the profile slug from a profile URL, decoded and lower-cased', () => {
    expect(profileSlugFromUrl('https://www.linkedin.com/in/Ren%C3%A9e-Dubois/')).toBe('renée-dubois');
    expect(profileSlugFromUrl('https://www.linkedin.com/in/jordan-lee-4b2a1c?trk=x')).toBe('jordan-lee-4b2a1c');
    expect(profileSlugFromUrl('https://www.linkedin.com/company/acme')).toBeNull();
  });

  it('hashes rows the same however their text is spaced or cased', () => {
    expect(rowHash('Hooli', 'Product Manager')).toBe(rowHash(' hooli ', 'product  manager'));
    expect(rowHash('Hooli', 'Product Manager')).not.toBe(rowHash('Hooli', 'Analyst'));
    expect(rowHash('a')).toMatch(/^h:[0-9a-f]{16}$/);
  });
});

describe('splitAnswers', () => {
  it('splits question:answer pairs and keeps colons in answers', () => {
    expect(splitAnswers('How many years?:6 | What time can you start?:9:30')).toEqual([
      { question: 'How many years?', answer: '6' },
      { question: 'What time can you start?', answer: '9:30' },
    ]);
  });

  it('joins a piece with no colon onto the answer before it', () => {
    expect(splitAnswers('Pick one:A | B')).toEqual([{ question: 'Pick one', answer: 'A | B' }]);
  });

  it('returns nothing for an empty cell', () => {
    expect(splitAnswers('')).toEqual([]);
    expect(splitAnswers(null)).toEqual([]);
  });
});

describe('readLinkedInArchive on the fixture', () => {
  it('reads every listed kind of file and lists the rest as unread', () => {
    const read = archive.files.filter((f) => f.kind !== null).map((f) => f.kind);
    const kinds: ArchiveKind[] = [
      'applications', 'screeningAnswers', 'connections', 'messages', 'invitations',
      'savedJobs', 'companyFollows', 'jobSeekerPreferences', 'savedJobAlerts',
      'positions', 'education', 'courses', 'certifications', 'honors', 'skills',
      'learning', 'receipts', 'identityAssets',
    ];
    for (const kind of kinds) {
      expect(read, kind).toContain(kind);
      expect(archive[kind].length, kind).toBeGreaterThan(0);
    }
    expect(archive.unread).toEqual(['Ad_Targeting.csv', 'Profile.csv']);
    expect(archive.files.flatMap((f) => f.problems)).toEqual([]);
  });

  it('reads both parts of Job Applications as one list, keeping a repeated job once', () => {
    expect(archive.applications.map((a) => a.key)).toEqual(['4012345678', '3999999999', rowHash('Initech', 'Operations Lead', '2025-12-01T12:40:00.000Z')]);
    const second = archive.files.find((f) => f.path === 'Jobs/Job Applications_1.csv');
    expect(second).toMatchObject({ records: 1, duplicates: 1 });

    const [acme, globex, initech] = archive.applications;
    expect(acme).toMatchObject({
      file: 'Jobs/Job Applications.csv',
      jobId: '4012345678',
      appliedAt: '2026-06-13T23:26:00.000Z',
      contactEmail: 'sam@example.com',
      contactPhone: '555-0100',
      companyName: 'Acme Robotics',
      jobTitle: 'Product Manager',
      resumeName: 'Sam Taylor CV.pdf',
    });
    expect(acme.answers).toEqual([
      { question: 'How many years of product management experience do you have?', answer: '6' },
      { question: 'Are you legally authorized to work in the United States?', answer: 'Yes' },
      { question: 'What time can you start?', answer: '9:30' },
      { question: 'Pick one', answer: 'A | B' },
    ]);
    expect(globex).toMatchObject({ appliedAt: '2026-01-02T00:05:00.000Z', contactPhone: null, answers: [] });
    expect(initech).toMatchObject({ jobId: null, jobUrl: null, answers: [{ question: 'Notice period', answer: '2 weeks' }] });
  });

  it('reads both screening answer files', () => {
    expect(archive.screeningAnswers.map((a) => [a.question, a.answer])).toEqual([
      ['Mobile phone number', '555-0100'],
      ['Are you willing to relocate?', 'No'],
      ['How many years of experience do you have with SQL?', '5'],
    ]);
  });

  it('skips the notes above the Connections header and keys people by slug', () => {
    expect(archive.connections).toEqual([
      {
        key: 'jordan-lee-4b2a1c', file: 'Connections.csv', profileSlug: 'jordan-lee-4b2a1c',
        profileUrl: 'https://www.linkedin.com/in/jordan-lee-4b2a1c', firstName: 'Jordan', lastName: 'Lee',
        email: null, company: 'Acme Robotics', position: 'Recruiter', connectedOn: '2026-08-21',
      },
      {
        key: 'renée-dubois', file: 'Connections.csv', profileSlug: 'renée-dubois',
        profileUrl: 'https://www.linkedin.com/in/Ren%C3%A9e-Dubois/', firstName: 'Renée', lastName: 'Dubois',
        email: 'renee@example.com', company: 'Globex', position: 'Director of Product', connectedOn: '2025-01-03',
      },
    ]);
  });

  it('reads multi-line quoted message content and keys messages under their conversation', () => {
    expect(archive.messages).toHaveLength(2);
    const [first, reply] = archive.messages;
    expect(first.content).toBe('Hi Sam,\n\nThanks for applying, "PM" role. Free for a call Tuesday?\nJordan');
    expect(first).toMatchObject({
      conversationId: '2-ZmFrZWNvbnZv',
      sentAt: '2026-08-21T15:14:57.000Z',
      senderProfileSlug: 'jordan-lee-4b2a1c',
      recipientProfileSlugs: ['sam-taylor-0a1b2c'],
      subject: 'Product Manager role',
      folder: 'INBOX',
      isDraft: false,
    });
    expect(first.key.startsWith('2-ZmFrZWNvbnZv:h:')).toBe(true);
    expect(reply.key).not.toBe(first.key);
  });

  it('reads invitations, saved jobs, follows, preferences and alerts', () => {
    expect(archive.invitations[0]).toMatchObject({
      direction: 'OUTGOING', sentAt: '2025-01-03T08:00:00.000Z',
      inviterProfileSlug: 'sam-taylor-0a1b2c', inviteeProfileSlug: 'renée-dubois', message: 'Enjoyed your talk.',
    });
    expect(archive.savedJobs).toEqual([{
      key: '4087654321', file: 'Jobs/Saved Jobs.csv', jobId: '4087654321', savedAt: '2026-08-21T15:14:00.000Z',
      jobUrl: 'https://www.linkedin.com/jobs/view/4087654321', jobTitle: 'Head of Product', companyName: 'Umbrella Health',
    }]);
    expect(archive.companyFollows).toEqual([{
      key: 'acme robotics', file: 'Company Follows.csv', organization: 'Acme Robotics', followedAt: '2026-08-21T19:02:55.000Z',
    }]);
    expect(archive.jobSeekerPreferences[0]).toMatchObject({
      key: 'job-seeker-preferences', locations: 'Denver, Colorado | Remote', jobTitles: 'Product Manager | Product Lead',
      openToRecruiters: true, dreamCompanies: null,
    });
    expect(archive.jobSeekerPreferences[0].values['Company Employee Count']).toBe('');
    expect(archive.savedJobAlerts[0]).toMatchObject({
      key: '77001', alertDate: '2026-08-01T09:00:00.000Z', parameters: 'keywords=product manager&location=Denver',
    });
  });

  it('reads the profile files with year-month and year dates', () => {
    expect(archive.positions.map((p) => [p.companyName, p.startedOn, p.finishedOn, p.location])).toEqual([
      ['Hooli', '2025-07', null, 'Denver, Colorado'],
      ['Initrode', '2016', '2025-06', null],
    ]);
    expect(archive.positions[0].description).toBe('Led the payments team.\nShipped two launches.');
    expect(archive.education[0]).toMatchObject({ schoolName: 'State University', startDate: '2012', endDate: '2016', degreeName: 'BSc Economics' });
    expect(archive.courses[0]).toMatchObject({ name: 'Econometrics', number: 'ECON 301' });
    expect(archive.certifications[0]).toMatchObject({ authority: 'Scrum Alliance', startedOn: '2024-03', finishedOn: '2026-03', licenseNumber: 'CSPO-123' });
    expect(archive.honors[0]).toMatchObject({ title: "Dean's List", issuedOn: '2015-12' });
    expect(archive.skills.map((s) => s.key)).toEqual(['product management', 'sql']);
  });

  it('reads Learning, receipts and resume text', () => {
    expect(archive.learning[0]).toMatchObject({
      title: 'Product Discovery', contentType: 'Course',
      lastWatchedAt: '2026-07-02T18:40:00.000Z', completedAt: '2026-07-03T20:15:00.000Z', saved: false, notes: null,
    });
    expect(archive.receipts[0]).toMatchObject({
      key: 'INV-0001', transactionAt: '2026-05-01T10:00:00.000Z', productName: 'Premium Career',
      currency: 'USD', subTotal: 39.99, taxAmount: 3.2, totalAmount: 43.19,
    });
    expect(archive.identityAssets[0]).toMatchObject({ name: 'Sam Taylor CV.pdf', text: 'Sam Taylor\nProduct Manager' });
  });

  it('gives identical records on every run and whatever order the zip holds', () => {
    expect(readLinkedInArchive(ZIP)).toEqual(archive);
    const entries = unzipSync(ZIP);
    const reversed = Object.fromEntries(Object.entries(entries).reverse());
    expect(readLinkedInArchive(zipSync(reversed))).toEqual(archive);
  });
});

describe('readLinkedInArchive edge cases', () => {
  it('reports a date it cannot read instead of guessing', () => {
    const zip = zipSync({
      'Company Follows.csv': strToU8('Organization,Followed On\nAcme,last Tuesday\n'),
    });
    const result = readLinkedInArchive(zip);
    expect(result.companyFollows[0].followedAt).toBeNull();
    expect(result.files[0].problems).toEqual([
      '1 value in "Followed On" did not read as a date, such as "last Tuesday"',
    ]);
  });

  it('reports a file with no header it knows', () => {
    const result = readLinkedInArchive(zipSync({ 'Skills.csv': strToU8('Something else\nx\n') }));
    expect(result.skills).toEqual([]);
    expect(result.files[0].problems).toEqual(['No header row with "Name" was found']);
  });

  it('throws on bytes that are not a zip', () => {
    expect(() => readLinkedInArchive(strToU8('not a zip'))).toThrow(/not a zip/);
  });

  it('matches files by name in any folder', () => {
    expect(specFor('Basic_LinkedInDataExport_10-19-2026/Jobs/Saved Jobs.csv')).toBe('savedJobs');
    expect(specFor('Job Applications_2.csv')).toBe('applications');
    expect(specFor('guide_messages.csv')).toBeNull();
  });
});
