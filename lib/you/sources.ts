import { courseHref, transcriptHref } from '@/lib/you/education';
import type { ModuleSources } from '@/lib/sources/types';

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
  ],
  notSources: [],
};
