import { readLinkedInArchive, skippedArchiveFiles, type LinkedInArchive } from '@/lib/linkedin/archive';
import { applyPlan, planImport } from './engine';
import { LINKEDIN_PROFILE_MAPPERS } from './linkedin-profile';
import type { ImportMapper, ImportPlan, ImportStore } from './types';
import { LINKEDIN_APPLICATION_MAPPERS } from './linkedin/applications';
import { LINKEDIN_SAVED_MAPPERS } from './linkedin/saved';
import { LINKEDIN_PURCHASE_MAPPERS } from './linkedin/purchases';
import { LINKEDIN_CONNECTION_MAPPERS } from './linkedin/connections';

// The LinkedIn export through the import engine (plan #2432.2), the one
// pipeline the settings page and scripts/import-linkedin.ts both run.
//
// LINKEDIN_MAPPERS is filled by the steps that import each kind (#2432.4 to
// #2432.8). Order matters: a mapper whose rows refer to another kind's rows
// with ref() comes after it.

export const LINKEDIN_SOURCE = 'linkedin';

export const LINKEDIN_MAPPERS: ImportMapper<LinkedInArchive>[] = [
  ...LINKEDIN_APPLICATION_MAPPERS,
  ...LINKEDIN_SAVED_MAPPERS,
  ...LINKEDIN_PURCHASE_MAPPERS,
  ...LINKEDIN_PROFILE_MAPPERS,
  ...LINKEDIN_CONNECTION_MAPPERS,
];

/**
 * The day the export was made, from LinkedIn's file name
 * ("Basic_LinkedInDataExport_10-19-2026.zip"), as YYYY-MM-DD.
 */
export function archiveDateFromName(name: string): string | null {
  const m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(name);
  if (!m) return null;
  const [, month, day, year] = m;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export interface LinkedInImport {
  archive: LinkedInArchive;
  plan: ImportPlan;
  /** Set when the plan was applied. */
  runId: string | null;
}

/** Reads the zip and plans its import; applies it too unless `dryRun`. */
export async function importLinkedIn(
  store: ImportStore,
  bytes: Uint8Array,
  options: {
    dryRun: boolean;
    archiveDate?: string | null;
    storagePath?: string | null;
    mappers?: ImportMapper<LinkedInArchive>[];
  },
): Promise<LinkedInImport> {
  const archive = readLinkedInArchive(bytes);
  // Saved jobs are measured against the export's own day (plan #2432.6).
  if (options.archiveDate) archive.exportedOn = options.archiveDate;
  const plan = await planImport(store, LINKEDIN_SOURCE, options.mappers ?? LINKEDIN_MAPPERS, archive);
  if (options.dryRun) return { archive, plan, runId: null };
  const runId = await applyPlan(store, plan, {
    archiveDate: options.archiveDate,
    storagePath: options.storagePath,
    skippedFiles: skippedArchiveFiles(archive),
  });
  return { archive, plan, runId };
}
