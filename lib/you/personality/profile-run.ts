import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { createCoreClient } from '@/lib/core/auth/server';
import { MODELS } from '@/lib/core/models';
import { usageFrom, type SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { createLearnClient } from '@/lib/learn/auth/server';
import { YOU_SCHEMA, type YouSupabaseClient } from '@/lib/you/db/schema-name';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadVaultRules } from '@/lib/vault/map/vault-rules';
import { relatedNotesStore, vectorForText } from '@/lib/vault/notes/related';
import {
  PROFILE_COLUMNS,
  PROFILE_MIN_RESULTS,
  PROFILE_SYSTEM,
  PROFILE_TOOL,
  PROFILE_TOOL_SCHEMA,
  profileFrom,
  profileFromRow,
  profileKey,
  profilePrompt,
  profileQueries,
  type PersonalityProfile,
  type ProfileRecord,
  type ProfileRow,
} from './profile';
import { chooseNotes, NOTES_PER_QUERY, READ_MIN_SIMILARITY, type CandidateNote } from './read';
import { loadResults, notesByIds, pinnedNotes } from './read-run';

/**
 * Dash's analysis across all of a person's personality tests (profile.ts),
 * written when the button on the Personality tab asks for it, and only then.
 * The tab offers the button when there is no analysis yet or a test was
 * added, changed or deleted since the newest.
 *
 * It reads every result, the newest row of you.insight_signals (the nightly
 * counts the insights run uses) and the Learn readings by status, and finds
 * the notes nearest each test as the per-test read does. One Sonnet call,
 * on the ledger as 'personality-profile'. Each run is a new row; the newest
 * is the one shown, and the one the board and the insights run read.
 */

const MODEL = MODELS.youPersonalityProfile;

/** The newest analysis, or null before the first. */
export async function loadPersonalityProfile(you: YouSupabaseClient): Promise<PersonalityProfile | null> {
  const { data, error } = await you
    .from('personality_profiles')
    .select(PROFILE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assertSchemaExposed(error, YOU_SCHEMA);
  if (error) throw new Error(`Reading the analysis across your tests failed: ${error.message}`);
  return data ? profileFromRow(data as unknown as ProfileRow) : null;
}

async function loadRecord(you: YouSupabaseClient): Promise<ProfileRecord> {
  const [signals, readings] = await Promise.all([
    you.from('insight_signals').select('day, signals').order('day', { ascending: false }).limit(1).maybeSingle(),
    createLearnClient().then((learn) => learn.from('readings').select('status')),
  ]);
  // A count that could not be read is left out of the prompt, never guessed.
  if (signals.error) console.error('[you personality profile] signals', signals.error.message);
  if (readings.error) console.error('[you personality profile] readings', readings.error.message);
  const byStatus: Record<string, number> = {};
  for (const row of (readings.data ?? []) as { status: string | null }[]) {
    if (row.status) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  const s = signals.data as { day: string; signals: Record<string, unknown> } | null;
  return {
    signals: s?.signals ?? null,
    signalsDay: s?.day ?? null,
    readings: readings.error ? null : byStatus,
  };
}

export type ProfileOutcome = { ok: true } | { ok: false; detail: string };

async function write(you: YouSupabaseClient, userId: string, client?: Anthropic): Promise<ProfileOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !client) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set.' };

  const results = await loadResults(you);
  if (results.length < PROFILE_MIN_RESULTS) {
    return { ok: false, detail: `An analysis across your tests needs at least ${PROFILE_MIN_RESULTS}.` };
  }

  const [vault, core] = await Promise.all([createVaultClient(), createCoreClient()]);
  const ports = relatedNotesStore(vault, userId, { core });
  const nearestIds = await Promise.all(
    profileQueries(results).map(async (text) => {
      const vector = await vectorForText(ports, text);
      if (!vector) return [];
      const rows = await ports.nearest(vector, {
        limit: NOTES_PER_QUERY,
        minSimilarity: READ_MIN_SIMILARITY,
        exclude: [],
      });
      return rows.filter((r) => r.similarity >= READ_MIN_SIMILARITY).map((r) => r.note_id);
    }),
  );
  const [bodies, pinned, rules, record] = await Promise.all([
    notesByIds(vault, userId, [...new Set(nearestIds.flat())]),
    pinnedNotes(vault, userId),
    loadVaultRules(vault, userId),
    loadRecord(you),
  ]);
  const nearest = nearestIds.map((ids) =>
    ids.map((id) => bodies.get(id)).filter((n): n is CandidateNote => Boolean(n)),
  );
  const notes = chooseNotes(pinned, nearest, undefined, rules);

  const anthropic = client ?? new Anthropic({ apiKey });
  const reports: SpendReport[] = [];
  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6144 + THINKING_ROOM,
      system: PROFILE_SYSTEM,
      tools: [
        {
          name: PROFILE_TOOL,
          description: 'Report the analysis across all the tests: a summary, agreements, tensions and patterns to watch.',
          input_schema: PROFILE_TOOL_SCHEMA,
        },
      ],
      tool_choice: forceTool(PROFILE_TOOL, MODEL),
      messages: [{ role: 'user', content: profilePrompt(results, record, notes) }],
    });
    reports.push({ model: MODEL, usage: usageFrom(response.usage) });
  } finally {
    await recordSpendReports(core, userId, { module: 'you', operation: 'personality-profile' }, reports);
  }

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === PROFILE_TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const profile = profileFrom(block.input, notes);
  if (!profile) return { ok: false, detail: 'The analysis came back in the wrong shape.' };

  const { error } = await you.from('personality_profiles').insert({
    user_id: userId,
    results_key: profileKey(results),
    summary: profile.summary,
    agreements: profile.agreements,
    tensions: profile.tensions,
    watch: profile.watch,
    model: MODEL,
  });
  if (error) throw new Error(`Keeping the analysis failed: ${error.message}`);
  return { ok: true };
}

/** Write the analysis now and keep it. Never throws. */
export async function runPersonalityProfile(
  you: YouSupabaseClient,
  userId: string,
  options: { client?: Anthropic } = {},
): Promise<ProfileOutcome> {
  try {
    const outcome = await write(you, userId, options.client);
    if (!outcome.ok) console.error('[you personality profile]', outcome.detail);
    return outcome;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The analysis failed.';
    console.error('[you personality profile]', detail);
    return { ok: false, detail };
  }
}
