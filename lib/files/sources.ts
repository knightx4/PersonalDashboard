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
      holds: 'What Dash wrote for their goals, kept as pages under the goal: lists, drafts, notes, research, breakdowns of their data, plans.',
      weight: 'record',
      search: ['title', 'summary', 'body'],
      title: 'title',
      href: fileHref,
      note: "Skip rows with archived_at set. made_by 'claude' is a run's work, 'you' is theirs. A goal or step links one through goals.links with kind 'file'; origin 'goals.items:<id>' is the step it was written for, and each step has one file, revised in versions through goals.file_result. read_at is null while they have not read the current version. Read the file before redoing its work, and revise it rather than writing a second one on the same question. Before revising one, read its thread in core.thread_turns (ref 'core.files:<id>'): what they wrote there is what they want changed.",
    },
  ],
  notSources: [
    { table: 'core.file_versions', reason: 'Earlier versions of a file; the file holds the current one.' },
    { table: 'core.file_comments', reason: 'The thread under a file until 3 October 2026, now read-only; the thread is in core.conversations under core.files:<id>.' },
  ],
};
