import type { ModuleSources } from '@/lib/sources/types';
import { fileHref } from './files';

/**
 * Files, as Goals reads them (lib/sources/types.ts). A file is work done for
 * the person, usually by an earlier run: reading it first saves working the
 * same thing out twice.
 */
export const filesSources: ModuleSources = {
  sources: [
    {
      table: 'core.files',
      module: 'Files',
      holds: 'Longer pieces written for them and kept as pages: research notes, breakdowns of their data, plans, drafts.',
      weight: 'record',
      search: ['title', 'summary', 'body'],
      title: 'title',
      href: fileHref,
      note: "Skip rows with archived_at set. made_by 'claude' is a run's work, 'you' is theirs. A goal or step links one through goals.links with kind 'file'. Read the file before redoing its work, and revise it rather than writing a second one on the same question.",
    },
  ],
  notSources: [{ table: 'core.file_versions', reason: 'Earlier versions of a file; the file holds the current one.' }],
};
