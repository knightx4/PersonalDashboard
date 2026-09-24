'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { serverEnv } from '@/lib/env';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadCollection } from '@/lib/goals/collections-store';
import { DOCUMENT_BUCKET, ownsDocumentPath, type PreviewRow } from '@/lib/goals/extract';
import { askExtractModel } from '@/lib/goals/extract-model';
import { readIntoForm, type ReadInput } from '@/lib/goals/extract-read';
import { loadInformationStep } from '@/lib/goals/steps-store';

/**
 * Reading pasted text or a document into an information step's form (plan
 * #955; docs/GOALS-SPEC.md, "Four ways to fill a form"). This only reads:
 * it hands back the rows the form starts from and saves nothing. Saving is
 * savePreviewAction in ./information-actions.ts, once you have checked them.
 *
 * A document is already in the goals-documents bucket when this runs. The
 * browser uploads it on your session, which keeps the file out of this
 * action's request body, and this reads it back on the same session, so the
 * bucket's policies (goals migration 0011) decide whose files it can reach.
 */

export type ReadFormState = {
  error?: string;
  rows?: PreviewRow[];
  source?: 'pasted' | 'document';
  /** The stored file's path, for a document. */
  ref?: string | null;
};

const Input = z.union([
  z.object({ stepId: z.string().uuid(), text: z.string().max(200_000) }),
  z.object({ stepId: z.string().uuid(), path: z.string().min(1).max(500) }),
]);

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

// latency: pending
export async function readIntoFormAction(
  raw: { stepId: string; text: string } | { stepId: string; path: string },
): Promise<ReadFormState> {
  const user = await requireUser();
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { error: 'Could not tell what to read.' };
  const input = parsed.data;

  const key = apiKey();
  if (!key) return { error: 'No ANTHROPIC_API_KEY on the deployment, so nothing can be read.' };

  const spend: SpendReport[] = [];
  try {
    const client = await createGoalsClient();
    const step = await loadInformationStep(client, input.stepId);
    if (!step) return { error: 'That step no longer has a form.' };
    const collection = await loadCollection(client, step.collectionId);
    if (!collection) return { error: 'The collection behind that step is gone.' };

    let read: ReadInput;
    let ref: string | null = null;
    if ('path' in input) {
      if (!ownsDocumentPath(user.id, input.path)) return { error: 'Could not find that file.' };
      const { data, error } = await client.storage.from(DOCUMENT_BUCKET).download(input.path);
      if (error || !data) return { error: 'That file could not be opened. Try uploading it again.' };
      read = { name: input.path, bytes: new Uint8Array(await data.arrayBuffer()) };
      ref = input.path;
    } else {
      read = { text: input.text };
    }

    const result = await readIntoForm(collection, read, (source) =>
      askExtractModel({ apiKey: key, onSpend: (report) => spend.push(report) }, collection, source),
    );
    await recordSessionSpend(user.id, { module: 'goals', operation: 'read-into-form' }, spend);
    if (!result.ok) return { error: result.error };
    return { rows: result.rows, source: ref ? 'document' : 'pasted', ref };
  } catch {
    await recordSessionSpend(user.id, { module: 'goals', operation: 'read-into-form' }, spend);
    return { error: 'That could not be read. Try again.' };
  }
}
