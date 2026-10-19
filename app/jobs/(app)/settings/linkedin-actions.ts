'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createCoreClient } from '@/lib/core/auth/server';
import { archiveDateFromName, importLinkedIn, supabaseImportStore } from '@/lib/imports';
import { requireUser } from '@/lib/jobs/auth/server';
import { formatDateInline } from '@/lib/jobs/applications/load';
import { IMPORTS_BUCKET, planView, type LinkedInPlanView } from '@/lib/jobs/linkedin-import';
import { isNotLinkedInExport, skippedArchiveFiles } from '@/lib/linkedin/archive';

/**
 * The LinkedIn export on Jobs settings (plan #2432.9). The browser puts the
 * zip in the person's folder of the imports bucket; planLinkedInImport reads
 * it back and says what an import would do, writing nothing, and
 * applyLinkedInImport plans it again and applies it, recording the run in
 * core.import_runs. Both run as the signed-in person, under row level
 * security, through the engine scripts/import-linkedin.ts also runs.
 */

const input = z.object({
  path: z.string().min(1).max(400),
  fileName: z.string().min(1).max(300),
});

type Input = z.infer<typeof input>;

async function load(raw: Input): Promise<
  | { error: string }
  | { userId: string; client: SupabaseClient; bytes: Uint8Array; path: string; fileName: string }
> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: 'That upload could not be found. Choose the file again.' };
  const user = await requireUser();
  const { path, fileName } = parsed.data;
  // The bucket's policies already keep each account to its own folder; this
  // says so before asking.
  if (!path.startsWith(`${user.id}/`)) return { error: 'That upload could not be found. Choose the file again.' };

  const client = (await createCoreClient()) as unknown as SupabaseClient;
  const { data, error } = await client.storage.from(IMPORTS_BUCKET).download(path);
  if (error || !data) return { error: 'The uploaded file could not be read back. Choose it again.' };
  return { userId: user.id, client, bytes: new Uint8Array(await data.arrayBuffer()), path, fileName };
}

export type PlanLinkedInResult = { plan: LinkedInPlanView } | { error: string };

// latency: pending
export async function planLinkedInImport(raw: Input): Promise<PlanLinkedInResult> {
  const loaded = await load(raw);
  if ('error' in loaded) return loaded;
  try {
    const store = supabaseImportStore(loaded.client, loaded.userId);
    const { archive, plan } = await importLinkedIn(store, loaded.bytes, { dryRun: true });
    if (isNotLinkedInExport(archive)) {
      return {
        error: `${loaded.fileName} is a zip, but none of its files are ones LinkedIn's export holds. Choose the zip LinkedIn emailed you, named like Basic_LinkedInDataExport_10-19-2026.zip.`,
      };
    }
    const day = archiveDateFromName(loaded.fileName);
    return {
      plan: planView(plan, {
        path: loaded.path,
        fileName: loaded.fileName,
        exportDate: day ? formatDateInline(day, 'UTC') : null,
        files: archive.files.length,
        skipped: skippedArchiveFiles(archive),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a zip file/i.test(message)) {
      return { error: `${loaded.fileName} is not a zip file. Choose the zip LinkedIn emailed you, without unpacking it.` };
    }
    return { error: `The export could not be read: ${message}` };
  }
}

export type ApplyLinkedInResult = { runId: string } | { error: string };

// latency: pending
export async function applyLinkedInImport(raw: Input): Promise<ApplyLinkedInResult> {
  const loaded = await load(raw);
  if ('error' in loaded) return loaded;
  try {
    const store = supabaseImportStore(loaded.client, loaded.userId);
    // The page offers Import only after the plan read this zip as an export.
    const { runId } = await importLinkedIn(store, loaded.bytes, {
      dryRun: false,
      storagePath: loaded.path,
      archiveDate: archiveDateFromName(loaded.fileName),
    });
    revalidatePath('/jobs/settings');
    return { runId: runId ?? '' };
  } catch (err) {
    revalidatePath('/jobs/settings');
    const message = err instanceof Error ? err.message : String(err);
    return { error: `The import stopped: ${message}` };
  }
}
