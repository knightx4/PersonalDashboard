'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import {
  addDevProject,
  archiveDevProject,
  listGithubRepositories,
  type RepositoryListing,
} from '@/lib/plan/project-add';

/**
 * The Projects page's three presses (plan #2553.5): open the picker, add a
 * repository, archive a project. Each is the owner's alone, as all of Dev
 * is, and writes through lib/plan/project-add.ts, which Dash's add_project
 * calls too.
 */

/** The pages a project's row is drawn on: the list, the plan's sections and the sidebar's shell. */
function redraw(id?: string) {
  revalidatePath('/dev/projects');
  revalidatePath('/dev/plan');
  if (id) revalidatePath(`/dev/projects/${id}`);
}

// latency: pending -- the picker shows its loading line until GitHub answers
export async function listRepositories(): Promise<RepositoryListing> {
  await requireOwner({ supabase: await createClient() });
  return listGithubRepositories();
}

const Repository = z.object({
  owner: z.string().trim().min(1).max(39),
  repo: z.string().trim().min(1).max(100),
});

export type AddProjectState =
  | { ok: true; id: string; label: string; restored: boolean }
  | { ok: false; error: string };

// latency: pending -- the row in the picker says Adding until the row is written
export async function addProject(input: { owner: string; repo: string }): Promise<AddProjectState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });
  const parsed = Repository.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Write the repository as owner/name.' };
  const result = await addDevProject({ db: supabase, userId: user.id, repository: parsed.data });
  if (!result.ok) return result;
  redraw(result.project.id);
  return { ok: true, id: result.project.id, label: result.project.label, restored: result.restored };
}

// latency: pending -- the menu's confirm stays until the row is archived
export async function archiveProject(form: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });
  const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).safeParse(form.get('id'));
  if (!id.success) return { ok: false, error: 'Could not tell which project that was.' };
  const result = await archiveDevProject({ db: supabase, userId: user.id, id: id.data });
  if (!result.ok) throw new Error(result.error);
  redraw(id.data);
  return { ok: true };
}
