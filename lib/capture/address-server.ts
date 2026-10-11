import 'server-only';

import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { z } from 'zod';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import type { AskDb, AskSchema, SchemaClient } from '@/lib/ask/db';
import type { CaptureAccount, CaptureAddressDeps } from '@/lib/capture/address';
import type { CaptureWriters } from '@/lib/capture/file';
import { loadCaptureSortLists } from '@/lib/capture/lists';
import { offeredCapturePlaces } from '@/lib/capture/place';
import type { CapturePlace, CaptureSortContext } from '@/lib/capture/sort';
import { sortCapture } from '@/lib/capture/sort-model';
import { checkCaptureToken } from '@/lib/capture/tokens';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { recordDashAction, type DashActionDeps } from '@/lib/core/dash-actions';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { writeRoleNote } from '@/lib/dash/writes';
import { publicEnv } from '@/lib/env';
import { fileCapture, type FiledEntry } from '@/lib/goals/capture';
import { askCaptureModel } from '@/lib/goals/capture-model';
import { keepCapture, loadCaptureContext, applyCaptureAction, saveFiled } from '@/lib/goals/capture-store';
import { GOALS_SCHEMA, historyHeaders, type GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { ModuleId } from '@/lib/modules';
import { taskInput } from '@/lib/todo/tasks/input';
import { todayIn } from '@/lib/todo/tasks/model';
import { openConnectedSource, noteCreatePorts } from '@/lib/vault/db/ports';
import { createCapturedNote } from '@/lib/vault/notes/create';
import { embedVaultNotes } from '@/lib/vault/notes/embed';
import { checkWriteAccess } from '@/lib/vault/notes/write-access';

/**
 * The capture address's clients (plan #1706): lib/capture/address.ts's
 * dependencies, bound to the service-role clients for the account a capture
 * token names.
 *
 * The route has no session, so nothing here has RLS behind it. Every write
 * sets user_id from the token check, and every read the writers make filters
 * by it: the todo insert here, the goals filing (loadCaptureContext passes
 * the user to loadLiveTree), the role note (writeRoleNote checks the role is
 * theirs), the vault connection (openConnectedSource with the user id), and
 * the sorter's lists (loadCaptureSortLists).
 *
 * Filing is the capture box's own (app/capture-actions.ts): the same writers,
 * the same records in core.dash_actions with surface 'capture', the same
 * spend operations. The goals filing below is fileGoalCapture
 * (app/goals/capture-actions.ts) on these clients; a change to one is a
 * change to the other.
 */

function apiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

/** The service-role client per schema, each made once per request. */
function serviceAskDb(): AskDb {
  const made = new Map<AskSchema, SchemaClient>();
  return async (schema) => {
    let client = made.get(schema);
    if (!client) {
      client = createServiceSchemaSupabase(schema);
      made.set(schema, client);
    }
    return client;
  };
}

/** A service-role goals client whose writes goals.history records as capture's, naming the capture. */
function serviceGoalsClient(history: { actor?: 'capture'; captureId?: string } = {}): GoalsSupabaseClient {
  const { SUPABASE_SERVICE_ROLE_KEY } = z
    .object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) })
    .parse(process.env);
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: GOALS_SCHEMA },
    global: { headers: historyHeaders(history) },
  }) as GoalsSupabaseClient;
}

/** How long the embedding after a vault note is written may run, as after a save. */
const EMBED_AFTER_WRITE_MS = 20_000;

/** A sentence filed against their goals, as fileGoalCapture files it from the box. */
async function fileGoals(
  userId: string,
  today: string,
  dash: DashActionDeps,
  recordSpend: (operation: 'file-capture', reports: SpendReport[]) => Promise<void>,
  body: string,
): Promise<{ captureId?: string; filed?: FiledEntry[]; error?: string }> {
  const key = apiKey();
  if (!key) return { error: 'Dash cannot file against your goals right now.' };
  const captureId = randomUUID();
  const client = serviceGoalsClient({ actor: 'capture', captureId });
  const reader = serviceGoalsClient();
  const spend: SpendReport[] = [];
  try {
    const result = await fileCapture(body, today, {
      keep: (text) => keepCapture(client, userId, captureId, text),
      context: () => loadCaptureContext(reader, { userId, today }),
      ask: (message, file) =>
        askCaptureModel({ apiKey: key, captureId, today, onSpend: (report) => spend.push(report) }, message, file),
      apply: (id, action) => applyCaptureAction(client, { userId, today, captureId: id, dash }, action),
      save: (id, filed) => saveFiled(client, id, filed),
    });
    await recordSpend('file-capture', spend);
    if (!result.ok) return { error: result.error, captureId: result.captureId ?? undefined };
    return { captureId: result.captureId, filed: result.filed };
  } catch (error) {
    await recordSpend('file-capture', spend);
    console.error('capture address: goals filing failed', error);
    return { error: 'That could not be filed against your goals.' };
  }
}

/** One account's places, sorter and writers, on the service-role clients. */
async function captureAccount(userId: string): Promise<CaptureAccount> {
  const db = serviceAskDb();
  const core = createCoreServiceSupabase();
  const dash: DashActionDeps = { userId, core: await db('core'), db };
  const settings = await loadAccountSettings(userId, core);
  const modules = settings.enabledModules as ModuleId[];
  const today = todayIn(settings.timezone);

  const vault = modules.includes('vault') ? createVaultServiceSupabase() : null;
  const vaultWritable =
    vault !== null && (await checkWriteAccess(() => openConnectedSource(vault, userId))) === 'yes';
  const places = offeredCapturePlaces(modules, { vaultWritable });

  const recordSpend = async (operation: 'place-capture' | 'file-capture', reports: SpendReport[]) => {
    if (reports.length === 0) return;
    try {
      const target =
        operation === 'place-capture'
          ? ({ module: 'core', operation } as const)
          : ({ module: 'goals', operation } as const);
      await recordSpendReports(core, userId, target, reports);
    } catch (error) {
      console.error(`[spend] capture address ${operation}`, error instanceof Error ? error.message : error);
    }
  };

  let lists: Promise<Pick<CaptureSortContext, 'goals' | 'roles'>> | null = null;
  const sort: CaptureAccount['sort'] = async (sentence, among: readonly CapturePlace[]) => {
    const key = apiKey();
    if (!key) return null;
    lists ??= loadCaptureSortLists(userId, places, { goals: () => db('goals'), jobs: () => db('job_search') });
    const { goals, roles } = await lists;
    const spend: SpendReport[] = [];
    try {
      return await sortCapture(sentence, { places: among, goals, roles }, {
        client: new Anthropic({ apiKey: key }),
        onSpend: (report) => spend.push(report),
      });
    } finally {
      await recordSpend('place-capture', spend);
    }
  };

  const writers: CaptureWriters = {
    todo: async (text) => {
      // The first line is the todo; anything after it, such as a shared link, is its notes.
      const [first, ...rest] = text.split('\n');
      const title = taskInput.shape.title.safeParse(first);
      if (!title.success) return { error: title.error.issues[0].message };
      const body = taskInput.shape.body.safeParse(rest.join('\n'));
      if (!body.success) return { error: body.error.issues[0].message };
      const todo = await db('todo');
      const { data, error } = await todo
        .from('tasks')
        .insert({ user_id: userId, title: title.data, body: body.data, due_on: today })
        .select('id')
        .single();
      if (error || !data) return { error: 'The todo could not be added.' };
      return { id: (data as { id: string }).id };
    },
    goals: (text) => fileGoals(userId, today, dash, recordSpend, text),
    jobs: async (roleId, text) => {
      const written = await writeRoleNote({ userId, enabledModules: modules, db }, roleId, text);
      return written.ok
        ? { ok: true as const, subjectRef: written.subjectRef }
        : { ok: false as const, error: written.error };
    },
    vault: async (text) => {
      if (!vault) return { ok: false as const, error: 'Your vault is switched off.' };
      const ports = noteCreatePorts({
        supabase: vault,
        userId,
        afterSave: () => {
          after(async () => {
            try {
              await embedVaultNotes(vault, core, { userId, deadline: Date.now() + EMBED_AFTER_WRITE_MS });
            } catch (error) {
              console.error('[capture address] note embedding', error instanceof Error ? error.message : error);
            }
          });
        },
      });
      const result = await createCapturedNote(ports, text);
      if (!result.ok) return { ok: false as const, error: result.error };
      return { ok: true as const, noteId: result.noteId, title: result.title, blobSha: result.blobSha };
    },
    record: (entry) => recordDashAction(dash, entry),
  };

  return { places, sort, writers };
}

/** The address's dependencies, for app/api/capture/route.ts. */
export function captureAddressDeps(): CaptureAddressDeps {
  return {
    check: (token) => checkCaptureToken(createCoreServiceSupabase() as unknown as SchemaClient, token),
    account: captureAccount,
  };
}
