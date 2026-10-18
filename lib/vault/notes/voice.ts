import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { MODELS } from '@/lib/core/models';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { usageFrom, type SpendReport, type SpendSink } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { sampleFor } from '@/lib/learn/vault/classify-payload';
import { forceTool } from '@/lib/learn/graph/tool-call';
import type { LearnOperation } from '@/lib/learn/spend';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Whose words each vault note is (plan #2413.3): private, audience, clipped,
 * reference or secret, in obsidian.notes.voice with a reason.
 *
 * Rules decide first, in SQL (obsidian.voice_by_rule, vault 0038): credential
 * notes are secret, Bulk - Wiki and Resources are clipped, Career/Job
 * Applications and anything titled or tagged as an application are audience,
 * course summaries and templates are reference. The rule pass is free, so the
 * sync runs it straight after writing notes, and a credential note is tagged
 * secret before anything reads it.
 *
 * What no rule decides goes to one Haiku call per note version, from the map
 * sweep's tick (every five minutes), which picks up whatever a sync wrote. A
 * note is due again when its blob or its path changes. A failed call leaves
 * the note due; the next tick asks again.
 *
 * obsidian.voice_due_notes never returns a note the credential rule matches,
 * so no secret note reaches the model.
 */

export const VOICES = ['private', 'audience', 'clipped', 'reference', 'secret'] as const;
export type NoteVoice = (typeof VOICES)[number];

export const VOICE_MODEL = MODELS.vaultNoteVoice;
export const VOICE_OPERATION: LearnOperation = 'tag-note-voice';
const TOOL_NAME = 'tag_voice';

const SYSTEM = `You read one note from a person's own notebook and say whose
words it is, so that a later reader does not mistake what they copied or wrote
to persuade someone for what they believe.

private: written for themselves. Their own thinking, ideas, plans, journal
entries, opinions, lists of what they want, notes to self.

audience: written for somebody else to read and judge. A job or school
application, an essay or statement, a cover letter, answers prepared for an
interview, a pitch, a post. Positions here may be what they wanted the reader
to believe rather than what they think.

clipped: mostly someone else's words or someone else's account. A pasted
article or web page, an encyclopedia-style entry, quotes, a summary of a book
or talk that reports its argument without the person's own view.

reference: a record kept to look things up, not an argument. Class notes of
what was taught, meeting notes, logistics, trip plans, contact details, task
lists, schedules.

secret: holds passwords, keys, account numbers or other credentials.

Where a note mixes kinds, choose the one most of its prose is. A summary with
the person's own reactions throughout is private; one that only reports is
clipped or reference.

Give one short sentence of reason, addressed to the person as "you". It is
shown to them, and they can disagree with it.`;

const answerSchema = z.object({
  voice: z.enum(VOICES),
  reason: z.string().trim().min(1).max(300),
});

export type VoiceAnswer = z.infer<typeof answerSchema>;

export type VoiceNote = {
  id: string;
  userId: string;
  path: string;
  title: string;
  /** The first 4,000 characters, as obsidian.voice_due_notes returns them. */
  body: string;
  frontmatter: Record<string, unknown>;
  blobSha: string;
};

/** What the model is shown: the folder, the title, any tags, and the opening. */
export function voicePrompt(note: Pick<VoiceNote, 'path' | 'title' | 'body' | 'frontmatter'>): string {
  const folder = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '(top of the vault)';
  const tags = note.frontmatter.tags;
  const tagLine = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === 'string').join(', ')
    : typeof tags === 'string'
      ? tags
      : '';
  return [
    `Folder: ${folder}`,
    `Title: ${note.title}`,
    ...(tagLine ? [`Tags: ${tagLine}`] : []),
    '',
    sampleFor(note.body),
  ].join('\n');
}

/** One note's voice from Haiku, or null when the answer could not be read. */
export type VoiceModel = (note: VoiceNote, onSpend: SpendSink) => Promise<VoiceAnswer | null>;

export function haikuForVoice(client: Pick<Anthropic, 'messages'>): VoiceModel {
  return async (note, onSpend) => {
    const response = await client.messages.create({
      model: VOICE_MODEL,
      max_tokens: 200,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Say whose words the note is.',
          input_schema: {
            type: 'object',
            properties: {
              voice: { type: 'string', enum: [...VOICES] },
              reason: { type: 'string' },
            },
            required: ['voice', 'reason'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME, VOICE_MODEL),
      messages: [{ role: 'user', content: voicePrompt(note) }],
    });
    onSpend({ model: VOICE_MODEL, usage: usageFrom(response.usage) });
    const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
    const parsed = block && block.type === 'tool_use' ? answerSchema.safeParse(block.input) : null;
    return parsed?.success ? parsed.data : null;
  };
}

export type VoicePorts = {
  /** Tag every due note a rule decides; returns how many. */
  tagByRule(): Promise<number>;
  /** Due notes no rule decides, in id order after `afterId`. */
  loadDue(afterId: string | null, limit: number): Promise<VoiceNote[]>;
  /** Write one note's voice, only if it is still the blob and path that were read. */
  save(note: VoiceNote, answer: VoiceAnswer): Promise<void>;
  model?: VoiceModel;
  ledger?(userId: string, report: SpendReport): Promise<void>;
  now?(): number;
};

export type VoiceSummary = {
  byRule: number;
  byModel: number;
  failed: number;
  /** Why the model pass stopped early, or null when nothing was left. */
  stopped: 'time' | 'no-key' | 'failures' | null;
};

const PAGE = 48;
const CONCURRENCY = 6;
/** After this many failed calls in one pass, the rest wait for the next tick. */
const FAILURES_BEFORE_STOPPING = 5;

export async function tagNoteVoices(opts: { ports: VoicePorts; deadline: number }): Promise<VoiceSummary> {
  const { ports, deadline } = opts;
  const clock = ports.now ?? (() => Date.now());
  const summary: VoiceSummary = { byRule: await ports.tagByRule(), byModel: 0, failed: 0, stopped: null };

  const model = ports.model;
  let after: string | null = null;
  for (;;) {
    if (clock() >= deadline) {
      summary.stopped = 'time';
      return summary;
    }
    const due = await ports.loadDue(after, PAGE);
    if (due.length === 0) return summary;
    if (!model) {
      summary.stopped = 'no-key';
      return summary;
    }
    after = due[due.length - 1].id;

    for (let i = 0; i < due.length; i += CONCURRENCY) {
      if (clock() >= deadline) {
        summary.stopped = 'time';
        return summary;
      }
      await Promise.all(
        due.slice(i, i + CONCURRENCY).map(async (note) => {
          try {
            const answer = await model(note, (report) => {
              void ports.ledger?.(note.userId, report);
            });
            if (!answer) {
              summary.failed += 1;
              return;
            }
            await ports.save(note, answer);
            summary.byModel += 1;
          } catch (err) {
            summary.failed += 1;
            console.error('[vault voice]', note.id, err instanceof Error ? err.message : err);
          }
        }),
      );
      if (summary.failed >= FAILURES_BEFORE_STOPPING) {
        summary.stopped = 'failures';
        return summary;
      }
    }
  }
}

/**
 * The ports over the service client. `userId` null works every account, which
 * only the map sweep's tick does; a sync names its vault's owner.
 */
export function noteVoicePorts(opts: {
  supabase: VaultSupabaseClient;
  core: Pick<CoreSupabaseClient, 'from'> | null;
  userId: string | null;
  anthropicApiKey?: string | null;
  client?: Pick<Anthropic, 'messages'>;
}): VoicePorts {
  const { supabase, core, userId } = opts;
  const client =
    opts.client ?? (opts.anthropicApiKey ? new Anthropic({ apiKey: opts.anthropicApiKey }) : null);

  return {
    async tagByRule() {
      const { data, error } = await supabase.rpc('tag_voice_by_rule', { p_user_id: userId });
      if (error) throw new Error(`Tagging note voices by rule failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },

    async loadDue(afterId, limit) {
      const { data, error } = await supabase.rpc('voice_due_notes', {
        p_user_id: userId,
        p_after_id: afterId,
        p_limit: limit,
      });
      if (error) throw new Error(`Reading notes to tag failed: ${error.message}`);
      return (
        (data ?? []) as Array<{
          id: string;
          user_id: string;
          path: string;
          title: string | null;
          body: string | null;
          frontmatter: Record<string, unknown> | null;
          blob_sha: string;
        }>
      ).map((row) => ({
        id: row.id,
        userId: row.user_id,
        path: row.path,
        title: row.title ?? row.path,
        body: row.body ?? '',
        frontmatter: row.frontmatter ?? {},
        blobSha: row.blob_sha,
      }));
    },

    async save(note, answer) {
      const { error } = await supabase
        .from('notes')
        .update({
          voice: answer.voice,
          voice_reason: answer.reason,
          voice_by: 'model',
          voice_blob_sha: note.blobSha,
          voice_path: note.path,
        })
        .eq('user_id', note.userId)
        .eq('id', note.id)
        .eq('blob_sha', note.blobSha)
        .eq('path', note.path);
      if (error) throw new Error(`Saving a note's voice failed: ${error.message}`);
    },

    ...(client ? { model: haikuForVoice(client) } : {}),

    ...(core
      ? {
          async ledger(owner: string, report: SpendReport) {
            await recordSpend(core, owner, {
              module: 'learn',
              operation: VOICE_OPERATION,
              model: report.model,
              usage: report.usage,
            });
          },
        }
      : {}),
  };
}
