import type { LinkedInArchive } from './types';

/** A file of the export left out, or read only in part, and why in words. */
export interface SkippedArchiveFile {
  path: string;
  reason: string;
}

/**
 * The files of an export the import left out or read only in part (plan
 * #2432.9), for the run history on Jobs settings: every file the reader does
 * not read, and every file it read with rows or cells it could not use.
 */
export function skippedArchiveFiles(archive: LinkedInArchive): SkippedArchiveFile[] {
  const out: SkippedArchiveFile[] = [];
  for (const file of archive.files) {
    if (file.kind === null) {
      out.push({ path: file.path, reason: 'Not a kind of record the import reads.' });
    } else if (file.problems.length > 0) {
      const read = file.records === 1 ? '1 record read' : `${file.records} records read`;
      const reason = `${read}; ${file.problems.join('; ')}`;
      out.push({ path: file.path, reason: /[.!?]$/.test(reason) ? reason : `${reason}.` });
    }
  }
  return out;
}

/** True when nothing in the zip is a file LinkedIn's export holds: the wrong zip. */
export function isNotLinkedInExport(archive: LinkedInArchive): boolean {
  return archive.files.every((file) => file.kind === null);
}
