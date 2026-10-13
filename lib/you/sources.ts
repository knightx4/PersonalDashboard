import { courseHref, transcriptHref } from '@/lib/you/education';
import type { ModuleSources } from '@/lib/sources/types';

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
      note:
        'transcript_id points at you.transcripts. year is the year of the term where the transcript gives one. ' +
        'grade is null for a course with no grade, such as transfer credit.',
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
      note: 'kind is big_five, mbti, enneagram or other. A big_five row has the five IPIP factor scores, 10 to 50 each (extraversion, agreeableness, conscientiousness, emotional_stability, intellect); the others have typed_value, the type as they typed it in from a test taken elsewhere. note is an optional line of their own about the result. A retake is a new row, so read the latest by taken_at. read_points is Dash\'s read of the result against their notes, once written.',
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
      note: 'moved_in and moved_out are a year (YYYY) or a month (YYYY-MM); no moved_out means they live there now. A place counts for a year when it was moved into that year or before and left that year or after.',
    },
  ],
  notSources: [],
};
