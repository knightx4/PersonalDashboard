import { courseHref, transcriptHref } from '@/lib/you/education';
import type { ModuleSources } from '@/lib/sources/types';
import { jobHref } from '@/lib/you/work-history';

/**
 * You's tables, as Goals reads them (lib/sources/types.ts): what is true about
 * the person. The transcripts and courses moved here from the Vault (plan
 * #1991.3). A new table in the you schema goes in one of these two lists, or
 * the gate says so.
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
      table: 'you.work_history',
      module: 'You',
      holds: 'The jobs they have held: employer, title, place and dates, read from their résumé or added by hand.',
      weight: 'record',
      search: ['employer', 'title', 'place', 'note'],
      title: 'employer',
      facts: ['started', 'ended', 'edited'],
      newest: 'started',
      href: jobHref,
      note:
        'started and ended are "YYYY" or "YYYY-MM"; ended is null for the job they hold now. ' +
        'edited is true when they corrected the row or added it themselves, so it is what they said rather than what Dash read.',
    },
  ],
  notSources: [],
};
