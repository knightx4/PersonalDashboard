'use server';

import Anthropic from '@anthropic-ai/sdk';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestAskDb, requestDashDeps } from '@/lib/ask/clients';
import { requireUser } from '@/lib/auth/server';
import { parseUploadedAttachments } from '@/lib/attachments/rules';
import { recordAttachments } from '@/lib/attachments/store';
import { fileCaptureParts, type CaptureFiled } from '@/lib/capture/file';
import { captureFiling, offeredCapturePlaces } from '@/lib/capture/place';
import {
  CAPTURE_PLACES,
  MAX_CAPTURE_PARTS,
  type CapturePart,
  type CapturePlace,
  type CaptureSort,
  type CaptureSortContext,
} from '@/lib/capture/sort';
import { loadCaptureSortLists } from '@/lib/capture/lists';
import { sortCapture } from '@/lib/capture/sort-model';
import { todoCaptureForm } from '@/lib/capture/todo';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadDashAction, recordDashAction, undoDashAction, undoneByVault } from '@/lib/core/dash-actions';
import { fileVaultNote, undoVaultCapture, vaultWritable } from '@/lib/capture/vault';
import { estimatePaidActions, type PaidCosts } from '@/lib/core/spend/paid-actions';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { writeRoleNote } from '@/lib/dash/writes';
import { serverEnv } from '@/lib/env';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { CAPTURE_BODY_MAX } from '@/lib/goals/capture';
import { CAPTURE_SORT_MIN_CHARS } from '@/lib/goals/capture-sort';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import type { ModuleId } from '@/lib/modules';
import { addTask } from '@/app/todo/actions';
import { fileGoalCapture } from '@/app/goals/capture-actions';

/**
 * The one capture box's server side (plan #1581, feature #1579): where a
 * sentence belongs while it is typed, filing it on Enter, and undoing a todo
 * or a job note it filed. Called from the shell's capture panel
 * (components/shell/capture.tsx), so it is reachable from every page.
 *
 * Filing goes through the writers that already exist: addTask for a todo,
 * fileGoalCapture for a goal update, and the add_role_note write for a job
 * (lib/capture/file.ts), and a new note in the vault's Inbox through
 * lib/capture/vault.ts (plan #1582). Each todo and note is recorded in
 * core.dash_actions with surface 'capture'; Goals records its own lines.
 */

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

/** Open goals and live roles change rarely; a pause in typing should not read them every time. */
const LISTS = new Map<string, { at: number; goals: CaptureSortContext['goals']; roles: CaptureSortContext['roles'] }>();
const LISTS_TTL_MS = 60_000;

/**
 * The sorter's context: the places this account can file into, its open
 * goals and the roles of its open applications, newest first.
 */
async function sortContext(userId: string): Promise<CaptureSortContext> {
  const settings = await loadAccountSettings(userId);
  const modules = settings.enabledModules as ModuleId[];
  // GitHub is asked only for an account with the vault, and at most every ten minutes.
  const vault = modules.includes('vault') && (await vaultWritable(userId));
  const places = offeredCapturePlaces(modules, { vaultWritable: vault });
  const held = LISTS.get(userId);
  if (held && Date.now() - held.at < LISTS_TTL_MS) return { places, goals: held.goals, roles: held.roles };

  const { goals, roles } = await loadCaptureSortLists(userId, places, {
    goals: () => createGoalsClient(),
    jobs: () => createJobsClient(),
  });
  LISTS.set(userId, { at: Date.now(), goals, roles });
  return { places, goals, roles };
}

/** One Haiku call, its cost recorded under place-capture. Null when it could not be made. */
async function sortFor(userId: string, sentence: string, context: CaptureSortContext): Promise<CaptureSort | null> {
  const key = apiKey();
  if (!key) return null;
  const spend: SpendReport[] = [];
  const sort = await sortCapture(sentence, context, {
    client: new Anthropic({ apiKey: key }),
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(userId, { module: 'core', operation: 'place-capture' }, spend);
  return sort;
}

export type CaptureBoxGuess = {
  /** Null when there is nothing to show yet: too short, or the call failed. */
  sort: CaptureSort | null;
  /** The places offered, for the chips when the sort is unsure. */
  places: readonly CapturePlace[];
};

/**
 * Where a sentence will go, asked by the box when typing pauses. Never
 * throws; a failed call is a null sort, and the box offers the places.
 */
// latency: pending
export async function sortCaptureBox(body: string): Promise<CaptureBoxGuess> {
  const user = await requireUser();
  const sentence = typeof body === 'string' ? body.trim() : '';
  try {
    const context = await sortContext(user.id);
    if (sentence.length < CAPTURE_SORT_MIN_CHARS || sentence.length > CAPTURE_BODY_MAX) {
      return { sort: null, places: context.places };
    }
    return { sort: await sortFor(user.id, sentence, context), places: context.places };
  } catch (error) {
    console.error('capture: sorting failed', error);
    return { sort: null, places: [] };
  }
}

const Place = z.enum(CAPTURE_PLACES as unknown as [CapturePlace, ...CapturePlace[]]);
const Part = z.object({
  place: Place,
  text: z.string().max(CAPTURE_BODY_MAX),
  goal: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  role: z.object({ id: z.string().uuid(), title: z.string(), company: z.string().nullable() }).nullable(),
});
const Shown = z.object({
  /** The sort the box showed, when it was sure. */
  sort: z
    .object({
      parts: z.array(Part).max(MAX_CAPTURE_PARTS),
      confidence: z.number().min(0).max(1),
      sure: z.boolean(),
    })
    .nullable(),
  /** The place the person picked from the chips. */
  picked: Place.nullable(),
});
export type CaptureBoxShown = z.infer<typeof Shown>;

export type CaptureBoxResult = CaptureFiled & {
  error?: string;
  /** Set when nothing was filed because Dash was not sure: the box shows the chips. */
  ask?: CaptureBoxGuess;
};

/**
 * File what was typed. With a sure sort or a pick from the box, each part
 * goes to its writer; with neither, the sentence is sorted here first, and an
 * unsure answer files nothing and comes back as `ask`.
 *
 * `uploaded` is what the box's "Add a file" put in the bucket (plan #1714).
 * Each row filed gets every file, so a capture Dash split in two holds them
 * on both; the copies in storage are shared.
 */
// latency: pending
export async function fileCaptureBox(
  body: string,
  shown: CaptureBoxShown,
  uploaded: unknown = [],
): Promise<CaptureBoxResult> {
  const user = await requireUser();
  const files = parseUploadedAttachments(uploaded, user.id);
  const sentence = typeof body === 'string' ? body.trim() : '';
  if (!sentence) return { filed: [], errors: [], error: 'Type something first.' };
  if (sentence.length > CAPTURE_BODY_MAX) {
    return { filed: [], errors: [], error: `Keep it under ${CAPTURE_BODY_MAX} characters.` };
  }
  const parsed = Shown.safeParse(shown);
  if (!parsed.success) return { filed: [], errors: [], error: 'That could not be read. Try again.' };

  const context = await sortContext(user.id);
  const offered = (place: CapturePlace) => context.places.includes(place);
  const { picked } = parsed.data;
  if (picked && !offered(picked)) {
    return { filed: [], errors: [], error: 'That workspace is switched off, so nothing can be filed there.' };
  }
  let sort: CaptureSort | null = parsed.data.sort
    ? { ...parsed.data.sort, parts: parsed.data.sort.parts.filter((part) => offered(part.place)) }
    : null;

  let filing = captureFiling(sentence, sort, picked);
  if (filing.kind === 'sort') {
    sort = await sortFor(user.id, sentence, context);
    filing = captureFiling(sentence, sort, picked);
  }
  // Picked a job when the sort named none: ask which, among the jobs only.
  if (filing.kind === 'file' && filing.parts.some((part) => part.place === 'jobs' && !part.role)) {
    const jobs = await sortFor(user.id, sentence, { ...context, places: ['jobs'] });
    const role = jobs?.parts.find((part) => part.role)?.role ?? null;
    filing = {
      kind: 'file',
      parts: filing.parts.map((part): CapturePart => (part.place === 'jobs' && !part.role ? { ...part, role } : part)),
    };
  }
  if (filing.kind !== 'file') {
    return { filed: [], errors: [], ask: { sort, places: context.places } };
  }

  const deps = await requestDashDeps(user.id);
  const settings = await loadAccountSettings(user.id);
  const result = await fileCaptureParts(filing.parts, {
    todo: (text) => addTask({}, todoCaptureForm(text, 'today')),
    goals: (text) => fileGoalCapture(text),
    jobs: async (roleId, text) => {
      const written = await writeRoleNote(
        { userId: user.id, enabledModules: settings.enabledModules as ModuleId[], db: requestAskDb() },
        roleId,
        text,
      );
      return written.ok
        ? { ok: true as const, subjectRef: written.subjectRef }
        : { ok: false as const, error: written.error };
    },
    vault: (text) => fileVaultNote(user.id, text),
    record: (entry) => recordDashAction(deps, entry),
    ...(files.length > 0
      ? {
          attach: async (ref: string) => {
            await recordAttachments(await createCoreClient(), user.id, ref, files);
            return files.length;
          },
        }
      : {}),
  });
  if (files.length > 0) revalidatePath('/todo', 'layout');
  if (result.filed.some((item) => item.place === 'vault')) revalidatePath('/vault', 'layout');
  if (result.filed.some((item) => item.place === 'jobs')) revalidatePath('/jobs', 'layout');
  revalidatePath('/home');
  return result;
}

export type CaptureBoxUndo = { ok: true; undoneAt: string } | { ok: false; error: string };

const Id = z.string().uuid();

/**
 * Undo a todo, a job note or a vault note the box filed, by its record: the
 * generic rule for the first two, and for a note its removal from the
 * repository as well (lib/capture/vault.ts).
 */
// latency: pending
export async function undoCaptureBox(actionId: string): Promise<CaptureBoxUndo> {
  const user = await requireUser();
  if (!Id.safeParse(actionId).success) return { ok: false, error: 'That is not there any more.' };
  try {
    const deps = await requestDashDeps(user.id);
    const action = await loadDashAction(deps, actionId);
    if (action && undoneByVault(action)) {
      const undone = await undoVaultCapture(deps, action);
      if (undone.ok) {
        revalidatePath('/vault', 'layout');
        revalidatePath('/home');
      }
      return undone;
    }
    const result = await undoDashAction(deps, actionId);
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath('/todo', 'layout');
    revalidatePath('/jobs', 'layout');
    revalidatePath('/home');
    return { ok: true, undoneAt: result.action.undoneAt ?? new Date().toISOString() };
  } catch (error) {
    console.error('capture: undo failed', error);
    return { ok: false, error: 'That could not be undone. Try again.' };
  }
}

/** The $ figure for the box's File it button, asked for once when the box opens. */
// latency: pending
export async function captureBoxCosts(): Promise<PaidCosts> {
  const user = await requireUser();
  try {
    const core = await createCoreClient();
    return await estimatePaidActions(core, user.id, ['app/capture-actions.ts#fileCaptureBox']);
  } catch {
    return {};
  }
}
