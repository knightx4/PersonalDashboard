import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { gatherMaterial, mayaRetrieveStore, type MayaMaterial, type MayaRetrievePorts } from './retrieve';
import { callThoughtModel, THOUGHT_MODEL } from './thought-model';
import { verifyThought, type MayaPoint, type MayaSynthesis, type MayaThought, type VerifyReport } from './verify';

/**
 * Maya's thought on one note, end to end (plan #1284): read the material,
 * call the model, check what it said. Writes nothing; the caller stores the
 * result in obsidian.maya_threads and maya_messages (plan #1285) and records
 * the spend under MAYA_THOUGHT_OPERATION with recordLearnSpend.
 *
 * `body` and `points` are shaped for maya_messages as they are: `body` is the
 * thought as plain text, empty when there are no points, and never longer
 * than MAYA_BODY_MAX; `points` is a JSON array of the points followed by the
 * synthesis when there is one, each tagged by `kind`.
 */

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const MAYA_THOUGHT_OPERATION: LearnOperation = 'write-maya-thought';

/** maya_messages.body is at most this long. */
export const MAYA_BODY_MAX = 8_000;

/** One element of maya_messages.points for a thought. */
export type MayaStoredItem = MayaPoint | MayaSynthesis;

export type WrittenThought = {
  ok: true;
  thought: MayaThought;
  /** For maya_threads.question: one line, never blank, at most 200 characters. */
  question: string;
  /** For maya_messages.body. '' when the thought has no points. */
  body: string;
  /** For maya_messages.points. An array, possibly empty. */
  points: MayaStoredItem[];
  /** For maya_messages.note_blob_sha. */
  noteBlobSha: string | null;
  /** For maya_messages.model. */
  model: string;
  report: VerifyReport;
};

export type ThoughtFailure = {
  ok: false;
  reason: 'not-found' | 'not-read' | 'no-key' | 'error';
  detail: string;
};

export type ThoughtOptions = {
  anthropicApiKey?: string;
  client?: Pick<Anthropic, 'messages'>;
  /** Told what each model request cost, whether or not the thought was usable. */
  onSpend?: SpendSink;
};

/** The points array as stored: points in rank order, then the synthesis. */
export function storedPoints(thought: MayaThought): MayaStoredItem[] {
  return [...thought.points, ...(thought.synthesis ? [thought.synthesis] : [])];
}

/** A stored points array read back, keeping only what has the stored shape. */
export function readStoredPoints(value: unknown): { points: MayaPoint[]; synthesis: MayaSynthesis | null } {
  const items = Array.isArray(value) ? (value as Partial<MayaStoredItem>[]) : [];
  const points = items.filter(
    (item): item is MayaPoint =>
      item?.kind === 'point' && typeof item.claim === 'string' && Array.isArray(item.notes) && Array.isArray(item.sources),
  );
  const synthesis =
    items.find(
      (item): item is MayaSynthesis =>
        item?.kind === 'synthesis' && typeof item.resolution === 'string' && Array.isArray(item.positionIds),
    ) ?? null;
  return { points, synthesis };
}

/** The thought as plain text, for maya_messages.body and for copying out. */
export function thoughtBody(thought: MayaThought): string {
  if (thought.points.length === 0) return '';
  const parts: string[] = [];
  for (const point of thought.points) {
    const lines = [`${point.rank}. ${point.claim}`, '', point.argument];
    for (const note of point.notes) {
      lines.push('', `From your note "${note.title}": "${note.quote}" ${note.point}`);
    }
    for (const source of point.sources) {
      const words = source.exactText ? ` In their words: "${source.exactText}"` : '';
      lines.push('', `${source.author}, ${source.work} (paraphrased): ${source.gist}${words}`);
    }
    parts.push(lines.join('\n'));
  }
  if (thought.synthesis) {
    const [left, right] = thought.synthesis.positionNames;
    parts.push(`Reconciling "${left}" and "${right}": ${thought.synthesis.resolution}`);
  }
  const body = parts.join('\n\n');
  return body.length > MAYA_BODY_MAX ? `${body.slice(0, MAYA_BODY_MAX - 1).trimEnd()}…` : body;
}

/** Call and check, from material already read. Never throws. */
export async function thoughtFromMaterial(
  material: MayaMaterial,
  options: ThoughtOptions,
): Promise<WrittenThought | ThoughtFailure> {
  if (!options.client && !options.anthropicApiKey) {
    return { ok: false, reason: 'no-key', detail: 'ANTHROPIC_API_KEY is not set.' };
  }
  const call = await callThoughtModel(material, options);
  if (!call.ok) return { ok: false, reason: 'error', detail: call.detail };

  const { thought, report } = verifyThought(call.raw, call.labels, material, call.searchText);
  return {
    ok: true,
    thought,
    question: thought.question,
    body: thoughtBody(thought),
    points: storedPoints(thought),
    noteBlobSha: material.note.blobSha,
    model: THOUGHT_MODEL,
    report,
  };
}

/**
 * Maya's thought on one of the person's notes. Never throws. `ports` replaces
 * the database reads, for tests.
 */
export async function writeThought(
  input: ThoughtOptions & {
    vault: VaultSupabaseClient;
    userId: string;
    noteId: string;
    ports?: MayaRetrievePorts;
  },
): Promise<WrittenThought | ThoughtFailure> {
  if (!input.client && !input.anthropicApiKey) {
    return { ok: false, reason: 'no-key', detail: 'ANTHROPIC_API_KEY is not set.' };
  }
  let material: MayaMaterial;
  try {
    const found = await gatherMaterial(input.ports ?? mayaRetrieveStore(input.vault, input.userId), input.noteId);
    if (!found.ok) return found;
    material = found.material;
  } catch (error) {
    return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
  return thoughtFromMaterial(material, input);
}
