import { courseHref, transcriptHref } from '@/lib/you/education';
import { parentBy, type ModuleSources, type Section } from '@/lib/sources/types';
import { jobHref } from '@/lib/you/work-history';

/** The sections of You's nav its rows sit under (app/you/layout.tsx). */
const PERSONALITY: Section = { href: '/you/personality', label: 'Personality' };
const DETAILS: Section = { href: '/you/details', label: 'Details' };
const PLACES: Section = { href: '/you/places', label: 'Places' };
const WORK: Section = { href: '/you/work', label: 'Work & school' };

/**
 * You's tables (lib/sources/types.ts): what is true about the person. Each is
 * what they did or said about themselves, so each is a source Goals may read.
 * Places is typed by hand. The transcripts and courses moved here from the Vault (plan #1991.3). A new
 * table in the you schema goes in one of the two lists, or the gate says so.
 */
export const youSources: ModuleSources = {
  sources: [
    {
      table: 'you.courses',
      module: 'You',
      holds: 'Every course on their academic transcripts: the school, code, title, term, credits and grade, as written.',
      weight: 'record',
      search: ['title', 'code', 'school', 'term'],
      title: 'title',
      href: courseHref,
      section: WORK,
      parent: parentBy('transcript_id', 'you.transcripts'),
      note:
        'transcript_id points at you.transcripts. year is the year of the term where the transcript gives one. ' +
        'grade is null for a course with no grade, such as transfer credit.',
    },
    {
      table: 'you.course_files',
      module: 'You',
      holds: 'The files they kept from a course: its syllabus, lecture slides, lecture notes and readings, each marked with its week.',
      weight: 'record',
      search: ['title', 'file_name', 'kind'],
      title: 'title',
      facts: ['week'],
      newest: 'uploaded_at',
      // A file opens on its course's line, which its ref alone cannot name.
      page: {
        title: 'title',
        reads: ['course_id'],
        href: (row) => (row.course_id ? courseHref(String(row.course_id)) : null),
        section: WORK,
        parent: parentBy('course_id', 'you.courses'),
      },
      note:
        'course_id points at you.courses. kind is syllabus, slides, lecture_notes or reading. ' +
        'week is the week of the course, or null for a file that spans it. ' +
        'The file is in the private you-course-files bucket at storage_path; a course holds at most 20.',
    },
    {
      table: 'you.transcripts',
      module: 'You',
      holds: 'The academic transcripts they have uploaded, one per school record, with the original file kept.',
      weight: 'record',
      search: ['school', 'file_name'],
      title: 'school',
      newest: 'uploaded_at',
      href: transcriptHref,
      section: WORK,
      note: 'The courses on each are in you.courses. The file is in the private vault-transcripts bucket at storage_path.',
    },
    {
      table: 'you.personality_results',
      module: 'You',
      holds: 'Personality tests they took or typed in, each with its date: Big Five scores, or a type such as INTJ or 5w4.',
      weight: 'record',
      search: ['test_name', 'typed_value', 'note', 'read_points'],
      title: 'test_name',
      href: () => '/you/personality',
      section: PERSONALITY,
      note: 'kind is big_five, mbti, enneagram or other. A big_five row has the five IPIP factor scores, 10 to 50 each (extraversion, agreeableness, conscientiousness, emotional_stability, intellect); the others have typed_value, the type as they typed it in from a test taken elsewhere. note is an optional line of their own about the result. A retake is a new row, so read the latest by taken_at. read_points is Dash\'s read of the result against their notes, once written.',
    },
    {
      table: 'you.details',
      module: 'You',
      holds: 'Their own details, one row: phone, LinkedIn address, citizenship, race, gender and sexuality, as they wrote them.',
      weight: 'record',
      search: ['title', 'phone', 'linkedin_url', 'citizenship', 'race', 'gender', 'sexuality'],
      title: 'title',
      newest: 'updated_at',
      ref: 'user_id',
      owner: 'user_id',
      href: () => '/you/details',
      section: DETAILS,
      // One row per person, with no id to name it by.
      page: null,
      note: 'A null is a detail they have not given. They chose that Dash may read all six (plan #2124.3).',
    },
    {
      table: 'you.places',
      module: 'You',
      holds: 'The places they have lived, with when they moved in and out.',
      weight: 'record',
      search: ['name', 'city', 'region', 'country', 'note'],
      title: 'name',
      facts: ['moved_in', 'moved_out'],
      newest: 'moved_in',
      href: (id) => `/you/places/${id}`,
      section: PLACES,
      note: 'moved_in and moved_out are a year (YYYY) or a month (YYYY-MM); no moved_out means they live there now. A place counts for a year when it was moved into that year or before and left that year or after.',
    },
    {
      table: 'you.work_history',
      module: 'You',
      holds: 'The jobs they have held: employer, title, place and dates, read from their résumé or added by hand.',
      weight: 'record',
      search: ['employer', 'title', 'place', 'note'],
      title: 'employer',
      facts: ['started', 'ended', 'edited'],
      newest: 'started',
      href: jobHref,
      section: WORK,
      parent: parentBy('resume_id', 'job_search.resume_versions'),
      note:
        'started and ended are "YYYY" or "YYYY-MM"; ended is null for the job they hold now. ' +
        'edited is true when they corrected the row or added it themselves, so it is what they said rather than what Dash read.',
    },
  ],
  notSources: [
    // Dash's writing about the person (plan #2413.1). Goals reading them would
    // cite Dash to itself as though it were something the person said.
    { table: 'you.insights', reason: 'Insights Dash wrote about them; Goals reading them would cite Dash to itself.' },
    { table: 'you.insight_verdicts', reason: 'Their marks on Dash\'s insights, read by the insights run, not by Goals.' },
    { table: 'you.insight_runs', reason: 'Bookkeeping for the runs that write insights.' },
  ],
};
