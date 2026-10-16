import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { SUBJECT_GOAL_TARGET, type LensRecord, type TopicName } from '@/lib/learn/levels/lenses';

/**
 * Reading and writing lenses (learn 0133 and 0137; plan #2138.7).
 *
 * Every subject and learning goal has a lens, which learn 0137's triggers
 * make and keep named. A survey subject's lens is hidden with its subject,
 * and an archived goal's with its goal. Progress is computed by
 * lib/learn/levels/lenses.ts on read, never stored here.
 */

type Client = LearnSupabaseClient;

type RawLens = {
  id: string;
  name: string;
  origin: string;
  subject_id: string | null;
  aim_id: string | null;
  created_at: string;
};

type RawTarget = { lens_id: string; topic_id: string; target_level: number; created_at: string };

function toRecord(lens: RawLens, targets: readonly RawTarget[]): LensRecord {
  return {
    id: lens.id,
    name: lens.name,
    origin: lens.origin === 'goal' ? 'goal' : lens.origin === 'theme' ? 'theme' : 'subject',
    subjectId: lens.subject_id,
    aimId: lens.aim_id,
    createdAt: lens.created_at,
    targets: targets
      .filter((t) => t.lens_id === lens.id)
      .map((t) => ({ topicId: t.topic_id, targetLevel: t.target_level, addedAt: t.created_at })),
  };
}

const LENS_COLUMNS = 'id, name, origin, subject_id, aim_id, created_at';

/** The lenses the Know page lists: real subjects' and open goals', by name. */
export async function listLenses(client: Client): Promise<LensRecord[]> {
  const [lenses, targets, hiddenSubjects, closedAims] = await Promise.all([
    client.from('lenses').select(LENS_COLUMNS).order('name'),
    client.from('lens_targets').select('lens_id, topic_id, target_level, created_at'),
    client.from('subjects').select('id').eq('survey', true),
    client.from('aims').select('id').not('archived_at', 'is', null),
  ]);
  for (const read of [lenses, targets, hiddenSubjects, closedAims]) {
    if (read.error) throw new Error(`Reading your lenses failed: ${read.error.message}`);
  }
  const hidden = new Set(((hiddenSubjects.data ?? []) as { id: string }[]).map((s) => s.id));
  const closed = new Set(((closedAims.data ?? []) as { id: string }[]).map((a) => a.id));
  const rows = ((targets.data ?? []) as RawTarget[]);
  return ((lenses.data ?? []) as RawLens[])
    .filter((l) => !(l.subject_id && hidden.has(l.subject_id)) && !(l.aim_id && closed.has(l.aim_id)))
    .map((l) => toRecord(l, rows));
}

/** What a lens came from, for its page: the subject's name, or the goal's. */
export type LensSource =
  | { kind: 'subject'; subjectId: string; name: string }
  | { kind: 'goal'; goalId: string | null; depth: string; archived: boolean }
  | null;

export type LensPageData = { lens: LensRecord; source: LensSource };

/** One lens, or null when it is not the person's. */
export async function loadLens(client: Client, id: string): Promise<LensPageData | null> {
  const { data, error } = await client.from('lenses').select(LENS_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Reading the lens failed: ${error.message}`);
  if (!data) return null;
  const raw = data as RawLens;
  const { data: targets, error: targetError } = await client
    .from('lens_targets')
    .select('lens_id, topic_id, target_level, created_at')
    .eq('lens_id', id);
  if (targetError) throw new Error(`Reading the lens's topics failed: ${targetError.message}`);
  const lens = toRecord(raw, (targets ?? []) as RawTarget[]);

  let source: LensSource = null;
  if (raw.subject_id) {
    const { data: subject } = await client.from('subjects').select('id, name').eq('id', raw.subject_id).maybeSingle();
    if (subject) source = { kind: 'subject', subjectId: subject.id as string, name: subject.name as string };
  } else if (raw.aim_id) {
    const { data: aim } = await client
      .from('aims')
      .select('goal_id, depth, archived_at')
      .eq('id', raw.aim_id)
      .maybeSingle();
    if (aim) {
      source = {
        kind: 'goal',
        goalId: (aim.goal_id as string | null) ?? null,
        depth: aim.depth as string,
        archived: aim.archived_at !== null,
      };
    }
  }
  return { lens, source };
}

/** Names, ceilings and whether approved, for every topic. */
export async function loadTopicNames(client: Client): Promise<Map<string, TopicName>> {
  const { data, error } = await client.from('topics').select('id, name, status, ceiling');
  if (error) throw new Error(`Reading your topics failed: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: string; name: string; status: string; ceiling: number }[]).map((t) => [
      t.id,
      { id: t.id, name: t.name, approved: t.status === 'approved', ceiling: t.ceiling },
    ]),
  );
}

/** Each topic's fields, for the Know page's fields by level. */
export async function loadTopicFields(client: Client): Promise<Map<string, string[]>> {
  const { data, error } = await client.from('topics').select('id, field_ids');
  if (error) throw new Error(`Reading your topics' fields failed: ${error.message}`);
  return new Map(((data ?? []) as { id: string; field_ids: string[] | null }[]).map((t) => [t.id, t.field_ids ?? []]));
}

/**
 * Set the target levels on one lens, each kept between 1 and its topic's
 * ceiling. Only topics already on the lens are changed. Returns how many
 * targets moved.
 */
export async function setLensTargets(
  client: Client,
  lensId: string,
  levels: ReadonlyMap<string, number>,
): Promise<number> {
  const { data, error } = await client
    .from('lens_targets')
    .select('id, topic_id, target_level, topics(ceiling)')
    .eq('lens_id', lensId);
  if (error) throw new Error(`Reading the lens's targets failed: ${error.message}`);
  let moved = 0;
  for (const row of (data ?? []) as unknown as {
    id: string;
    topic_id: string;
    target_level: number;
    topics: { ceiling: number } | null;
  }[]) {
    const wanted = levels.get(row.topic_id);
    if (wanted === undefined) continue;
    const level = Math.max(1, Math.min(row.topics?.ceiling ?? 10, Math.round(wanted)));
    if (level === row.target_level) continue;
    const { error: writeError } = await client.from('lens_targets').update({ target_level: level }).eq('id', row.id);
    if (writeError) throw new Error(`Setting a target failed: ${writeError.message}`);
    moved += 1;
  }
  return moved;
}

/**
 * Put a topic on a subject's lens, as a topic drafted from the subject's page
 * is (plan #2138.7): at solid, never above the topic's ceiling. A topic
 * already on the lens keeps its target. The lens's goals take it in through
 * learn 0137's trigger. Returns the lens, or null when the subject has none.
 */
export async function addToSubjectLens(
  client: Client,
  userId: string,
  subjectId: string,
  topicId: string,
): Promise<string | null> {
  const [{ data: lens, error }, { data: topic, error: topicError }] = await Promise.all([
    client.from('lenses').select('id').eq('subject_id', subjectId).maybeSingle(),
    client.from('topics').select('ceiling').eq('id', topicId).maybeSingle(),
  ]);
  if (error) throw new Error(`Reading the subject's lens failed: ${error.message}`);
  if (topicError) throw new Error(`Reading the topic failed: ${topicError.message}`);
  if (!lens || !topic) return null;
  const { error: writeError } = await client.from('lens_targets').upsert(
    {
      user_id: userId,
      lens_id: lens.id,
      topic_id: topicId,
      target_level: Math.min(topic.ceiling as number, SUBJECT_GOAL_TARGET),
    },
    { onConflict: 'lens_id,topic_id', ignoreDuplicates: true },
  );
  if (writeError) throw new Error(`Adding the topic to the subject failed: ${writeError.message}`);
  return lens.id as string;
}

/**
 * Carry a draft's lens targets to the topic it is merged into, before the
 * draft goes and its targets with it. A lens that already has that topic
 * keeps its own target.
 */
export async function carryLensTargets(client: Client, userId: string, fromId: string, intoId: string): Promise<void> {
  const { data, error } = await client.from('lens_targets').select('lens_id, target_level').eq('topic_id', fromId);
  if (error) throw new Error(`Reading the draft's lenses failed: ${error.message}`);
  const rows = ((data ?? []) as { lens_id: string; target_level: number }[]).map((t) => ({
    user_id: userId,
    lens_id: t.lens_id,
    topic_id: intoId,
    target_level: t.target_level,
  }));
  if (rows.length === 0) return;
  const { error: writeError } = await client
    .from('lens_targets')
    .upsert(rows, { onConflict: 'lens_id,topic_id', ignoreDuplicates: true });
  if (writeError) throw new Error(`Keeping the draft's lenses failed: ${writeError.message}`);
}
