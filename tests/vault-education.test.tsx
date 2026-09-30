/**
 * The vault's Education tab (plan #1308). The runner has no DOM, so what is
 * pinned is the markup: the empty state says what to upload, the check view
 * starts from what was read with every field editable, and a saved school
 * lists its terms newest first with each transcript's original linked.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/app/vault/education/actions', () => ({
  discardUploadAction: vi.fn(),
  readTranscriptAction: vi.fn(),
  saveTranscriptAction: vi.fn(),
  updateCourseAction: vi.fn(),
  removeCourseAction: vi.fn(),
  removeTranscriptAction: vi.fn(),
}));
vi.mock('@/lib/auth/client', () => ({ createClient: vi.fn() }));

import { AddTranscript, CheckCourses } from '@/app/vault/education/add-transcript';
import { SchoolCourses } from '@/app/vault/education/course-list';
import { groupCourses } from '@/lib/vault/education';
import type { Course, Transcript } from '@/lib/vault/transcripts';

const USER = 'u1';

describe('AddTranscript', () => {
  it('says what to upload when there is nothing yet', () => {
    const html = renderToStaticMarkup(<AddTranscript empty />);
    expect(html).toContain('No transcripts yet');
    expect(html).toContain('a PDF, a Word document, a photo or pasted text');
    expect(html).toContain('Add a transcript');
    expect(html).not.toContain('Claude');
  });

  it('is one quiet line once transcripts exist', () => {
    const html = renderToStaticMarkup(<AddTranscript empty={false} />);
    expect(html).toContain('Add a transcript');
    expect(html).not.toContain('No transcripts yet');
  });
});

describe('CheckCourses', () => {
  const draft = {
    path: `${USER}/x-t.pdf`,
    fileName: 'transcript.pdf',
    sizeBytes: 1234,
    school: 'State University',
    courses: [
      { school: 'State University', code: 'MATH 101', title: 'Calculus I', term: 'Fall 2019', year: 2019, credits: 4, grade: 'A-', position: 0 },
      { school: 'City College', code: null, title: 'Intro to Film', term: null, year: null, credits: 3, grade: null, position: 1 },
    ],
  };

  it('starts from what was read, every field editable, before anything is saved', () => {
    const html = renderToStaticMarkup(<CheckCourses draft={draft} onDone={() => {}} />);
    expect(html).toContain('name="school"');
    expect(html).toContain('value="State University"');
    expect(html).toContain('name="course.0.title"');
    expect(html).toContain('value="Calculus I"');
    expect(html).toContain('name="course.0.grade"');
    expect(html).toContain('value="A-"');
    expect(html).toContain('name="rows" value="0,1"');
    expect(html).toContain('Save 2 courses');
    expect(html).toContain('Nothing is saved until you press Save');
    // The transfer credit shows its own school; the home course does not.
    expect(html).toContain('name="course.1.school"');
    expect(html).not.toContain('name="course.0.school"');
  });

  it('asks for the school when the read found none', () => {
    const html = renderToStaticMarkup(<CheckCourses draft={{ ...draft, school: null }} onDone={() => {}} />);
    expect(html).toContain('could not find the school');
  });
});

describe('SchoolCourses', () => {
  const t: Transcript = {
    id: 't1',
    user_id: USER,
    school: 'State University',
    file_name: 'transcript.pdf',
    storage_path: `${USER}/x-transcript.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 10,
    uploaded_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
  const course = (id: string, title: string, term: string, year: number, position: number): Course => ({
    id,
    user_id: USER,
    transcript_id: 't1',
    school: 'State University',
    code: null,
    title,
    term,
    year,
    credits: 3,
    grade: 'B+',
    position,
    created_at: '',
    updated_at: '',
  });

  it('lists terms newest first, with grade and credits, and links the original', () => {
    const [group] = groupCourses([t], [course('a', 'Old course', 'Fall 2019', 2019, 0), course('b', 'New course', 'Spring 2021', 2021, 1)]);
    const html = renderToStaticMarkup(<SchoolCourses group={group} courseCounts={{ t1: 2 }} />);
    expect(html).toContain('State University');
    expect(html.indexOf('Spring 2021')).toBeLessThan(html.indexOf('Fall 2019'));
    expect(html).toContain('B+');
    expect(html).toContain('3 credits');
    expect(html).toContain('6 credits');
    expect(html).toContain('id="course-a"');
    expect(html).toContain('href="/vault/education/file/t1"');
    expect(html).toContain('Delete');
  });
});
