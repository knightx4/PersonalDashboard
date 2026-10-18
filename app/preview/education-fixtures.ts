import type { TranscriptDraft } from '@/app/you/work/actions';
import { courseExplainPrompt, type CourseExplain } from '@/lib/learn/evidence/course-explain';
import { groupCourses } from '@/lib/you/education';
import type { ChosenFile } from '@/app/you/work/course-files';
import type { Course, CourseFile, CourseFileKind, CourseWeek, Transcript } from '@/lib/you/transcripts';
import { HAIKU } from '@/lib/core/models';

/** Fixtures for the Work & school tab's surfaces in the preview gallery (plan #1308). */

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

function offer(courseId: string, titles: string[]): CourseExplain {
  const topics = titles.map((title, i) => ({ id: `${courseId}-t${i}`, title }));
  return { state: 'offer', question: courseExplainPrompt(topics), topics };
}

/**
 * The explain prompt on graded courses named for their topics (plan
 * #2172.4.2): three offered, one with eight topics, one answered with a topic
 * tested, one at a lower level and one the answer did not show. The
 * ungraded course and the ones not yet named have none.
 */
export const educationExplains: Record<string, CourseExplain> = {
  c3: offer('c3', ['Microeconomics', 'Supply and demand', 'Market equilibrium', 'Price elasticity of demand']),
  c4: offer('c4', [
    'Statistics',
    'Probability distribution',
    'Statistical hypothesis testing',
    'Confidence interval',
    'Linear regression',
    'Sampling (statistics)',
    'Standard deviation',
    'Data analysis',
  ]),
  c5: {
    state: 'tested',
    answeredAt: '2026-10-14T19:20:00Z',
    results: [
      { title: 'Computer programming', level: 3 },
      { title: 'Algorithm', level: 2 },
      { title: 'Data structure', level: 0 },
    ],
  },
  c7: offer('c7', ['Microeconomics', 'Game theory', 'General equilibrium theory']),
};

function kept(
  id: string,
  kind: CourseFileKind,
  week: number | null,
  title: string,
  fileName: string,
  size: number,
  position: number,
  summary: CourseFile['summary'] = null,
): CourseFile {
  const pptx = fileName.endsWith('.pptx');
  return {
    id,
    user_id: USER,
    course_id: 'c3',
    kind,
    title,
    week,
    position,
    file_name: fileName,
    storage_path: `${USER}/c3/${id}-${fileName}`,
    mime_type: pptx ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf',
    size_bytes: size,
    uploaded_at: '2026-10-18T09:00:00Z',
    updated_at: '2026-10-18T09:00:00Z',
    summary,
  };
}

/** Dash's summary of a file, as Summarise keeps it (plan #2401.4). */
function summarised(summary: string, points: string[]): CourseFile['summary'] {
  return { summary, points, model: HAIKU, read_at: '2026-10-18T10:00:00Z' };
}

/**
 * The files kept under ECON 101 (plan #2401.2): a syllabus, two weeks of
 * slides and notes, a deck with no week, a reading with a long title and one
 * with a week. The first week's slides and the long reading have been
 * summarised (plan #2401.4). Every other course holds none, and STATS 250
 * shows the empty state when opened.
 */
export const educationFiles: Record<string, CourseFile[]> = {
  c3: [
    kept('f1', 'syllabus', null, 'ECON 101 Winter 2018 syllabus', 'ECON101_W18_syllabus.pdf', 214_331, 0),
    kept(
      'f2',
      'slides',
      1,
      'Lecture 01 Scarcity and choice',
      'Lecture_01_Scarcity_and_choice.pptx',
      6_402_118,
      1,
      summarised(
        'Economics studies how people choose when what they want outruns what they have. Every choice gives up the next best thing, and that forgone option is its real cost.',
        [
          'Scarcity means wants exceed the resources to meet them, so every society must choose.',
          'The opportunity cost of a choice is the value of the best alternative given up.',
          'People respond to incentives, so a change in costs or benefits changes behaviour.',
        ],
      ),
    ),
    kept('f3', 'lecture_notes', 1, 'Week 1 notes', 'Week_1_notes.pdf', 88_204, 2),
    kept('f4', 'slides', 2, 'Lecture 02 Supply and demand', 'Lecture_02_Supply_and_demand.pptx', 9_870_552, 3),
    kept('f5', 'slides', null, 'Review session before the midterm', 'Review_session.pptx', 3_118_004, 4),
    kept(
      'f6',
      'reading',
      2,
      'Mankiw, Principles of Microeconomics, chapter 4: The market forces of supply and demand',
      'Mankiw_ch4.pdf',
      2_480_916,
      5,
      summarised(
        'A market brings buyers and sellers of one good together, and in a competitive market no single one of them sets the price. Demand falls as the price rises and supply rises with it, and the price settles where the quantity buyers want meets the quantity sellers offer. A shift in either curve, from tastes, incomes, input costs or the number of sellers, moves that price and quantity to a new equilibrium.',
        [
          'The law of demand: other things equal, the quantity demanded falls when the price rises.',
          'The law of supply: other things equal, the quantity supplied rises when the price rises.',
          'Market demand and supply are the sums of every buyer and seller at each price.',
          'At equilibrium the quantity demanded equals the quantity supplied; a surplus or a shortage pushes the price back toward it.',
          'A change in the price moves along a curve, while a change in anything else shifts the whole curve.',
        ],
      ),
    ),
    kept('f7', 'reading', null, 'Hayek, The use of knowledge in society', 'Hayek_1945.pdf', 1_204_448, 6),
  ],
};

function chosen(key: number, name: string, size: number, kind: CourseFileKind, week: string, extra: Partial<ChosenFile> = {}): ChosenFile {
  return { key, name, size, kind, week, problem: null, refused: false, progress: null, ...extra };
}

/** The add drawer with files chosen: two ready, one refused for its type, one for its size. */
export const educationChosen: ChosenFile[] = [
  chosen(0, 'Lecture_03_Elasticity.pptx', 7_204_118, 'slides', '3'),
  chosen(1, 'Week 3 notes.pdf', 120_331, 'lecture_notes', '3'),
  chosen(2, 'Lecture_04_recording.mp4', 412_000_000, 'slides', '4', {
    refused: true,
    problem: 'Not a file the course can keep. Use a PDF, PowerPoint, Word document, photo or text file.',
  }),
  chosen(3, 'Problem set scans, all weeks.pdf', 38_201_554, 'reading', '', {
    refused: true,
    problem: 'Over 20 MB (36.4 MB).',
  }),
];

/** The same drawer mid-upload: one going, one failed with its reason, one waiting its turn. */
export const educationUploading: ChosenFile[] = [
  chosen(0, 'Lecture_03_Elasticity.pptx', 7_204_118, 'slides', '3', { progress: 0.62 }),
  chosen(1, 'Week 3 notes.pdf', 120_331, 'lecture_notes', '3', {
    problem: 'The connection dropped. Try again.',
  }),
  chosen(4, 'Krugman, The age of diminished expectations, chapter 2.pdf', 3_402_118, 'reading', '3'),
];

function slot(week: number, title: string | null, extra: Partial<CourseWeek> = {}): CourseWeek {
  return { id: `w${week}`, course_id: 'c3', week, title, edited_at: null, removed_at: null, ...extra };
}

/**
 * ECON 101's weeks as Dash laid them out from its syllabus (plan #2401.6):
 * the first two hold files, three to seven are empty slots, week 4's topic
 * was edited by hand, week 5 was removed, and week 7 has the longest topic.
 */
export const educationWeeks: Record<string, CourseWeek[]> = {
  c3: [
    slot(1, 'Scarcity and choice'),
    slot(2, 'Supply and demand'),
    slot(3, 'Elasticity'),
    slot(4, 'Consumer choice and utility', { edited_at: '2026-10-18T11:00:00Z' }),
    slot(5, 'Midterm', { removed_at: '2026-10-18T11:00:00Z' }),
    slot(6, null),
    slot(7, 'Market structures: perfect competition, monopoly, oligopoly and monopolistic competition'),
  ],
};

/** The add drawer on a course with weeks laid out: two files, each with its week picked by name. */
export const educationChosenWeeks: ChosenFile[] = [
  chosen(0, 'Lecture_03_Elasticity.pptx', 7_204_118, 'slides', '3'),
  chosen(1, 'Krugman, The age of diminished expectations, chapter 2.pdf', 3_402_118, 'reading', '7'),
];
