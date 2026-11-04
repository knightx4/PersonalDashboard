import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicEnv } from '@/lib/env';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { triageRow } from '@/lib/feedback/triage-run';
import { sendIdeaToPlan } from '@/lib/ideas/send-to-plan';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { insertPlanItem } from '@/lib/plan/insert-item';
import { nextPlanPosition } from '@/lib/plan/position';
import { loadDevProjects, type DevProject } from '@/lib/plan/projects';
import { keyHash, noteKeyTable } from '@/lib/project-notes/keys';
import {
  feedbackFeatureDetail,
  feedbackFeatureTitle,
  noteIdeaBody,
  noteStepDetail,
  noteStepTitle,
  routesToStep,
  type ProjectNoteOutcome,
} from '@/lib/project-notes/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any>;

/**
 * Filing a note from a project's own app (lib/project-notes/route.ts says
 * where it goes, docs/PROJECT-NOTES.md how an app is connected).
 *
 * SERVICE ROLE. The app has no Dash session, only a token Dash gave it, so
 * this checks the token against the project's key table and then writes as
 * the owner (`core.dev_owner_id()`), the only account a project belongs to.
 * Every query below names the owner's id.
 */

const Body = z.string().trim().min(3, 'Write a sentence or two describing it.').max(4000);
const Page = z.string().trim().max(300);

export type FileProjectNote =
  | { ok: true; outcome: ProjectNoteOutcome; ideaId: string }
  | { ok: false; status: number; error: string };

export type Service = { pub: Client; core: Client };

export function serviceClients(): Service {
  const key = z.object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) }).parse(process.env).SUPABASE_SERVICE_ROLE_KEY;
  const url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  const auth = { persistSession: false, autoRefreshToken: false };
  return {
    pub: createClient(url, key, { auth }),
    core: createClient(url, key, { auth, db: { schema: 'core' } }),
  };
}

/** The project a token may file notes for, with the owner it belongs to, or why not. */
export async function authoriseProjectApp(
  db: Service,
  projectId: string,
  token: string | null,
): Promise<{ ok: true; ownerId: string; project: DevProject } | { ok: false; status: number; error: string }> {
  const table = noteKeyTable(projectId);
  if (!table) return { ok: false, status: 404, error: 'This project does not take notes.' };
  if (!token) return { ok: false, status: 401, error: 'Open the app from Dash to connect it.' };

  const { data: key } = await db.pub.from(table).select('key_hash').eq('key_hash', keyHash(token)).maybeSingle();
  if (!key) return { ok: false, status: 401, error: 'This computer is not connected. Open the app from Dash again.' };

  const { data: ownerId, error } = await db.core.rpc('dev_owner_id');
  if (error || typeof ownerId !== 'string') return { ok: false, status: 500, error: 'No owner is set.' };

  const project = (await loadDevProjects(db.pub, ownerId)).find((p) => p.id === projectId && !p.archivedAt);
  if (!project) return { ok: false, status: 404, error: 'This project is not in Dev.' };
  return { ok: true, ownerId, project };
}

/**
 * Save the note as an idea under the project, triage it, and move it to a
 * step when triage is sure it is one fix; otherwise the caller sends it to be
 * shaped (`sendProjectNoteToPlan`). Triage is short (two seconds at most), so
 * the app hears where the note went.
 */
export async function fileProjectNote(
  db: Service,
  input: { ownerId: string; project: DevProject; body: string; page: string | null },
): Promise<FileProjectNote> {
  const text = Body.safeParse(input.body);
  if (!text.success) return { ok: false, status: 400, error: text.error.issues[0].message };
  const parsedPage = input.page ? Page.safeParse(input.page) : null;
  const page = parsedPage?.success && parsedPage.data ? parsedPage.data : null;
  const { ownerId, project } = input;

  const { data: idea, error } = await db.pub
    .from('ideas')
    .insert({ user_id: ownerId, body: noteIdeaBody(text.data, page), module: project.id, source: 'me' })
    .select('id')
    .single();
  if (error || !idea?.id) return { ok: false, status: 500, error: 'The note could not be saved. Try again.' };
  const ideaId = String(idea.id);

  const spend: SpendReport[] = [];
  const triage = (await jevEnabledFor(db.core, ownerId))
    ? await triageRow(db.pub, { userId: ownerId, table: 'ideas', id: ideaId, spend }).catch(() => null)
    : null;
  await recordSpendReports(db.core, ownerId, { module: 'core', operation: 'triage-note' }, spend).catch(() => {});

  if (routesToStep(triage)) {
    const step = await addFeedbackStep(db.pub, ownerId, project, text.data, page);
    if (step) {
      await db.pub.from('ideas').update({ plan_item_id: step.id }).eq('id', ideaId).eq('user_id', ownerId);
      return { ok: true, outcome: { as: 'step', number: step.number }, ideaId };
    }
  }
  return { ok: true, outcome: { as: 'idea' }, ideaId };
}

/**
 * A note that is not one fix: scored when Jev is on, then straight on to be
 * shaped into a proposed feature on the plan, the path a note from Dash's own
 * header takes (lib/ideas/send-to-plan.ts). Never throws.
 */
export async function sendProjectNoteToPlan(db: Service, ownerId: string, ideaId: string): Promise<void> {
  const score = await jevEnabledFor(db.core, ownerId).catch(() => false);
  await sendIdeaToPlan(db.pub, {
    userId: ownerId,
    ideaId,
    score,
    record: (spend) => recordSpendReports(db.core, ownerId, { module: 'core', operation: 'score-idea' }, spend),
  });
}

/** The step, under the project's feedback feature (made the first time). */
async function addFeedbackStep(
  pub: Client,
  ownerId: string,
  project: DevProject,
  body: string,
  page: string | null,
): Promise<{ id: string; number: number } | null> {
  const featureId = await feedbackFeature(pub, ownerId, project);
  if (!featureId) return null;
  const written = await insertPlanItem(pub, {
    userId: ownerId,
    module: project.id,
    parentId: featureId,
    title: noteStepTitle(body),
    detail: noteStepDetail(body, page),
    status: 'not_started',
    kind: 'build',
    priority: 2,
    position: await nextPlanPosition(pub, ownerId, project.id, featureId),
  });
  return 'error' in written ? null : written;
}

async function feedbackFeature(pub: Client, ownerId: string, project: DevProject): Promise<string | null> {
  const title = feedbackFeatureTitle(project.label);
  const { data: found } = await pub
    .from('plan_items')
    .select('id')
    .eq('user_id', ownerId)
    .eq('module', project.id)
    .is('parent_id', null)
    .eq('title', title)
    .not('status', 'in', '(done,dropped)')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (found?.id) return String(found.id);
  const made = await insertPlanItem(pub, {
    userId: ownerId,
    module: project.id,
    parentId: null,
    title,
    detail: feedbackFeatureDetail(project.label),
    status: 'not_started',
    kind: 'build',
    priority: 2,
    position: await nextPlanPosition(pub, ownerId, project.id, null),
  });
  return 'error' in made ? null : made.id;
}
