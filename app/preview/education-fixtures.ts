import type { TranscriptDraft } from '@/app/vault/education/actions';
import { groupCourses } from '@/lib/vault/education';
import type { Course, Transcript } from '@/lib/vault/transcripts';

/** Fixtures for the Education tab's surfaces in the preview gallery (plan #1308). */

const USER = '00000000-0000-4000-8000-000000000001';

export const educationDraft: TranscriptDraft = {
  path: `${USER}/5f0c7a2e-8d1b-4e3f-a2c4-9b8d7e6f5a41-Official_Transcript_2021.pdf`,
  fileName: 'Official Transcript 2021.pdf',
  sizeBytes: 482_113,
  school: 'University of Michigan',
  courses: [
    { school: 'University of Michigan', code: 'MATH 115', title: 'Calculus I', term: 'Fall 2017', year: 2017, credits: 4, grade: 'A-', position: 0 },
    { school: 'University of Michigan', code: 'ENGLISH 125', title: 'Writing and Academic Inquiry', term: 'Fall 2017', year: 2017, credits: 4, grade: 'B+', position: 1 },
    { school: 'University of Michigan', code: 'ECON 101', title: 'Principles of Economics I: Microeconomics', term: 'Winter 2018', year: 2018, credits: 4, grade: 'A', position: 2 },
    { school: 'Washtenaw Community College', code: 'PSY 100', title: 'Introductory Psychology', term: 'Summer 2017', year: 2017, credits: 3, grade: null, position: 3 },
  ],
};

const transcripts: Transcript[] = [
  {
    id: 't-umich',
    user_id: USER,
    school: 'University of Michigan',
    file_name: 'Official Transcript 2021.pdf',
    storage_path: `${USER}/a-Official_Transcript_2021.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 482_113,
    uploaded_at: '2026-09-28T10:00:00Z',
    updated_at: '2026-09-28T10:00:00Z',
  },
  {
    id: 't-lse',
    user_id: USER,
    school: 'London School of Economics',
    file_name: 'LSE General Course transcript scan.jpg',
    storage_path: `${USER}/b-LSE_General_Course_transcript_scan.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 2_301_442,
    uploaded_at: '2026-09-29T10:00:00Z',
    updated_at: '2026-09-29T10:00:00Z',
  },
];

function course(
  id: string,
  transcript_id: string,
  school: string,
  code: string | null,
  title: string,
  term: string | null,
  year: number | null,
  credits: number | null,
  grade: string | null,
  position: number,
): Course {
  return { id, user_id: USER, transcript_id, school, code, title, term, year, credits, grade, position, created_at: '', updated_at: '' };
}

const courses: Course[] = [
  course('c1', 't-umich', 'University of Michigan', 'MATH 115', 'Calculus I', 'Fall 2017', 2017, 4, 'A-', 0),
  course('c2', 't-umich', 'University of Michigan', 'ENGLISH 125', 'Writing and Academic Inquiry', 'Fall 2017', 2017, 4, 'B+', 1),
  course('c3', 't-umich', 'University of Michigan', 'ECON 101', 'Principles of Economics I: Microeconomics', 'Winter 2018', 2018, 4, 'A', 2),
  course('c4', 't-umich', 'University of Michigan', 'STATS 250', 'Introduction to Statistics and Data Analysis', 'Winter 2018', 2018, 4, 'A', 3),
  course('c5', 't-umich', 'University of Michigan', 'EECS 183', 'Elementary Programming Concepts', 'Fall 2018', 2018, 4, 'A+', 4),
  course('c6', 't-umich', 'Washtenaw Community College', 'PSY 100', 'Introductory Psychology', 'Summer 2017', 2017, 3, null, 5),
  course('c7', 't-lse', 'London School of Economics', 'EC202', 'Microeconomic Principles II', 'Michaelmas 2019', 2019, 1, '72', 0),
  course('c8', 't-lse', 'London School of Economics', 'GV101', 'Introduction to Political Science', 'Michaelmas 2019', 2019, 1, '68', 1),
  course('c9', 't-lse', 'London School of Economics', null, 'Summer School: Behavioural Economics', null, null, null, 'P', 2),
];

export const educationGroups = groupCourses(transcripts, courses);

export const educationCounts: Record<string, number> = { 't-umich': 6, 't-lse': 3 };
