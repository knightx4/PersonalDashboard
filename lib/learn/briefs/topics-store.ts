import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { readDrafting } from '@/lib/learn/levels/draft-sources';
import { runTopicDraft, type DraftRunResult } from '@/lib/learn/levels/draft-run';
import { goalTargetLevel } from '@/lib/learn/levels/lenses';
import { FOUND_KIND_LABELS, readSections, type FoundKind } from './model';
import { briefDraftSources, goalPerformances, readDraftedFromBrief, type BriefGoalOption, type BriefGoalPanel } from './topics';

/**
 * The reads and writes that put a research brief's topics under a goal (plan
 * #2184.1); lib/learn/briefs/topics.ts says what the sources are.
 *
 * Drafting runs the topic compiler on the brief's pages under the goal the
 * person chose, and the draft lands on its own page to be read and approved
 * like any other. Approving one (`settleBriefTopic`) puts it on the goal's
 * lens at the goal's depth and records the goal on the brief, after which the
 * brief's cards are written for that goal.
 *
 * Every read and write goes through the person's own client.
 */

type Client = LearnSupabaseClient;

export async function loadBriefGoalPanel(client: Client, briefId: string): Promise<BriefGoalPanel> {
  const [aims, topics, brief] = await Promise.all([
    client.from('aims').select('id, name').is('archived_at', null).order('created_at', { ascending: true }),
    client
      .from('topics')
      .select('id, name, status, drafting, created_at')
      .eq('drafting->brief->>id', briefId)
      .order('created_at', { ascending: true }),
    client.from('briefs').select('aim_id').eq('id', briefId).maybeSingle(),
  ]);
  if (aims.error) throw new Error(`Could not read your goals: ${aims.error.message}`);
  if (topics.error) throw new Error(`Could not read the brief's topics: ${topics.error.message}`);
  const goals = (aims.data ?? []) as BriefGoalOption[];
  const aimId = (brief.data as { aim_id: string | null } | null)?.aim_id ?? null;
  return {
    goals,
    topics: ((topics.data ?? []) as { id: string; name: string; status: string; drafting: unknown }[]).map((row) => ({
      id: row.id,
      name: row.name,
      approved: row.status === 'approved',
      aimName: readDraftedFromBrief((row.drafting as { brief?: unknown } | null)?.brief)?.aimName ?? '',
    })),
    aim: goals.find((goal) => goal.id === aimId) ?? null,
  };
}

/** The performances drafted for the goal's topics so far, newest first. */
async function performancesFor(client: Client, aimId: string): Promise<string[]> {
  const { data: lens } = await client.from('lenses').select('id').eq('aim_id', aimId).maybeSingle();
  if (!lens) return [];
  const { data, error } = await client
    .from('lens_targets')
    .select('topics ( drafting, created_at )')
    .eq('lens_id', (lens as { id: string }).id);
  if (error) return [];
  type Row = { topics: { drafting: unknown; created_at: string } | { drafting: unknown; created_at: string }[] | null };
  return goalPerformances(
    ((data ?? []) as unknown as Row[]).flatMap((row) => {
      const topic = Array.isArray(row.topics) ? row.topics[0] : row.topics;
      const drafting = topic ? readDrafting(topic.drafting) : null;
      return topic && drafting ? [{ createdAt: topic.created_at, performances: drafting.performances }] : [];
    }),
  );
}

/**
 * Draft the topic a ready brief is about, under one goal: the compiler run
 * twice on the brief's pages and the goal's performances. Returns the draft's
 * id, or why there is none.
 */
export async function draftBriefTopic(
  client: Client,
  userId: string,
  input: { briefId: string; aimId: string; anthropicApiKey: string },
): Promise<DraftRunResult> {
  const [brief, aim, readings] = await Promise.all([
    client.from('briefs').select('id, question, status, sections').eq('id', input.briefId).maybeSingle(),
    client.from('aims').select('id, name').eq('id', input.aimId).maybeSingle(),
    client.from('readings').select('id, title, found_kind, summary').eq('brief_id', input.briefId).order('position'),
  ]);
  if (brief.error || !brief.data) return { ok: false, detail: 'That research could not be found.' };
  if (aim.error || !aim.data) return { ok: false, detail: 'That goal could not be found. Choose another.' };
  if (readings.error) return { ok: false, detail: `Could not read the brief's sources: ${readings.error.message}` };
  const row = brief.data as { id: string; question: string; status: string; sections: unknown };
  if (row.status !== 'ready') return { ok: false, detail: 'The research has to finish before its topics can be drafted.' };

  const sources = briefDraftSources(
    { question: row.question, sections: readSections(row.sections) },
    ((readings.data ?? []) as { id: string; title: string | null; found_kind: string | null; summary: string | null }[]).map(
      (reading) => ({
        readingId: reading.id,
        title: reading.title?.trim() || 'A source',
        kind: reading.found_kind ? (FOUND_KIND_LABELS[reading.found_kind as FoundKind] ?? null) : null,
        summary: reading.summary,
      }),
    ),
    await performancesFor(client, input.aimId),
  );
  if (sources.sources.length === 0) {
    return { ok: false, detail: 'The research quoted nothing to draft a topic from.' };
  }
  const goal = aim.data as { id: string; name: string };
  return runTopicDraft(client, userId, {
    goal: row.question,
    sources,
    brief: { id: row.id, question: row.question, aimId: goal.id, aimName: goal.name },
    anthropicApiKey: input.anthropicApiKey,
  });
}

/**
 * After a topic drafted from a brief is approved: put it on the goal's lens
 * at the goal's depth (a target already there is kept) and record the goal
 * on the brief. Returns the brief, or null for a topic no brief drafted.
 */
export async function settleBriefTopic(
  client: Client,
  userId: string,
  topicId: string,
): Promise<{ briefId: string; aimId: string } | null> {
  const { data: topic, error } = await client.from('topics').select('ceiling, drafting').eq('id', topicId).maybeSingle();
  if (error) throw new Error(`Reading the topic failed: ${error.message}`);
  const from = readDraftedFromBrief((topic?.drafting as { brief?: unknown } | null)?.brief);
  if (!topic || !from) return null;

  const [{ data: lens, error: lensError }, { data: aim }] = await Promise.all([
    client.from('lenses').select('id').eq('aim_id', from.aimId).maybeSingle(),
    client.from('aims').select('depth').eq('id', from.aimId).maybeSingle(),
  ]);
  if (lensError) throw new Error(`Reading the goal's lens failed: ${lensError.message}`);
  if (!lens) throw new Error('That goal is no longer there, so the topic was approved without it.');
  const { error: targetError } = await client.from('lens_targets').upsert(
    {
      user_id: userId,
      lens_id: (lens as { id: string }).id,
      topic_id: topicId,
      target_level: goalTargetLevel((aim as { depth: string } | null)?.depth ?? 'solid', topic.ceiling as number),
    },
    { onConflict: 'lens_id,topic_id', ignoreDuplicates: true },
  );
  if (targetError) throw new Error(`Adding the topic to the goal failed: ${targetError.message}`);

  const { error: briefError } = await client
    .from('briefs')
    .update({ aim_id: from.aimId, updated_at: new Date().toISOString() })
    .eq('id', from.id);
  if (briefError) throw new Error(`Putting the research under the goal failed: ${briefError.message}`);
  return { briefId: from.id, aimId: from.aimId };
}
