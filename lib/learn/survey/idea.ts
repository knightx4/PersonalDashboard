import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { kindSchema, masterySchema } from '@/lib/learn/graph/chain-payload';
import { KIND_RULE, KIND_TOOL_FIELD } from '@/lib/learn/graph/kind-prompt';
import { MASTERY_RULE, MASTERY_TOOL_FIELD } from '@/lib/learn/graph/mastery-prompt';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import type { ConceptKind } from '@/lib/learn/graph/model';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { surveySubjectForTheme } from './subject';

/**
 * The idea a survey question tests (plan #853).
 *
 * Before Practice Flow asks about a vault theme you have no track for, it
 * writes down one specific idea from your own notes on that theme, and the
 * question is written against that idea. A question written from the theme's
 * name alone tests the name; one written from a claim in your notes tests
 * whether you still hold what you wrote.
 *
 * The idea is read from the theme's about line and a few of the notes linked
 * to it, and it has to quote the note it came from. A quote that is not in the
 * note is refused, so every idea written here points at text you wrote. A
 * theme with no live notes is skipped before any model call and before its
 * hidden subject is made.
 *
 * The idea is an ordinary `learn.concepts` row in the theme's survey subject
 * (#840), inserted directly. `saveChain` and `findOrCreateSubject` would find
 * the subject by name and turn it into a real track.
 *
 * Haiku, as in `from-note.ts`: this is picking a claim out of text somebody
 * wrote, not judging whether it is true.
 */

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'report_idea';

/** How many of a theme's notes are read. The median theme has one. */
export const SURVEY_NOTES_READ = 4;

/** How much of each note is sent. A note past this is cut at the limit. */
export const SURVEY_NOTE_CHARS = 6000;

/** The shortest quote accepted. Shorter than this and it proves nothing. */
const MIN_QUOTE_CHARS = 20;

const SYSTEM = `Somebody keeps notes on a subject and has never been tested on it. Pick ONE
idea from their notes that a single question could test.

ONE SPECIFIC CLAIM. Something the notes assert, that could be true or false and
that a person could get wrong: "A policy rate only reaches prices through what
people expect it to do next". Not the subject's name, not a topic heading, not
"the notes discuss X".

FROM THE NOTES. The idea must be stated in the notes you are given, in the
note's own terms. Quote the sentence or phrase it comes from exactly as it is
written, and name the note by its title. Do not bring in anything the notes do
not say.

NOT ONE ALREADY TAKEN. You may be given ideas already written for this subject.
Pick a different one.

${MASTERY_RULE}

${KIND_RULE}

IF THE NOTES HOLD NO CLAIM -- they are lists, links, to-dos, or somebody
thinking out loud without landing anywhere -- set none true and leave the rest
empty.`;

export type ThemeNoteText = { title: string; body: string };

export type SurveySource = {
  theme: { id: string; name: string; about: string };
  notes: ThemeNoteText[];
};

export type SurveyIdea = {
  name: string;
  claim: string;
  /** Where the idea came from, naming the note and quoting it. */
  basis: string;
  noteTitle: string;
  quote: string;
  mastery: string[] | null;
  kind: ConceptKind | null;
};

export type IdeaResult =
  | { ok: true; idea: SurveyIdea }
  | { ok: false; reason: 'nothing-in-it' | 'ungrounded' | 'error'; detail: string };

const payloadSchema = z.object({
  none: z.boolean().optional(),
  name: z.string().optional().default(''),
  claim: z.string().optional().default(''),
  note_title: z.string().optional().default(''),
  quote: z.string().optional().default(''),
  mastery: masterySchema,
  kind: kindSchema,
});

/** Lower case with runs of space and quote marks folded, for finding a quote. */
function folded(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

/** The note as it is sent: the start of the body, up to the limit. */
export function noteExcerpt(body: string): string {
  return body.length > SURVEY_NOTE_CHARS ? body.slice(0, SURVEY_NOTE_CHARS) : body;
}

/**
 * Check a reported idea against the notes it was read from.
 *
 * The note has to be one of those sent, the quote has to appear in the part of
 * it that was sent, and the idea cannot be the theme's name or one already
 * written. Returns the reason it fails, or null when it holds.
 */
export function whyUngrounded(
  report: { name: string; claim: string; noteTitle: string; quote: string },
  source: SurveySource,
  existing: readonly string[],
): string | null {
  if (!report.name.trim() || !report.claim.trim()) return 'The idea came back without a claim.';
  const note = source.notes.find((n) => folded(n.title) === folded(report.noteTitle));
  if (!note) return `The idea names a note that was not given ("${report.noteTitle}").`;
  const quote = folded(report.quote.replace(/^["'“‘]+|["'”’]+$/g, ''));
  if (quote.length < MIN_QUOTE_CHARS) return 'The idea came back without a quote from the note.';
  if (!folded(noteExcerpt(note.body)).includes(quote)) {
    return `The quote is not in "${note.title}".`;
  }
  const name = folded(report.name);
  if (name === folded(source.theme.name)) return "The idea is the theme's name.";
  if (existing.some((taken) => folded(taken) === name)) return 'The idea is one already written.';
  return null;
}

/**
 * Ask for one idea from the theme's notes, and check it came from them.
 *
 * Pure apart from the model call, so it can be tested with a stub client. The
 * caller has already made sure there is at least one note.
 */
export async function ideaFromThemeNotes(input: {
  source: SurveySource;
  /** Names of the ideas already in the theme's survey subject. */
  existing: readonly string[];
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<IdeaResult> {
  const { source } = input;
  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });

  const lines = [`Subject: ${source.theme.name}`, `What it covers: ${source.theme.about}`];
  for (const note of source.notes) {
    lines.push('', `Note: ${note.title}`, '"""', noteExcerpt(note.body), '"""');
  }
  if (input.existing.length > 0) {
    lines.push(
      '',
      'Ideas already written for this subject:',
      ...input.existing.map((n) => `- ${n}`),
    );
  }
  lines.push('', `Call ${TOOL_NAME}.`);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the one idea from these notes that a question should test.',
          input_schema: {
            type: 'object',
            properties: {
              none: { type: 'boolean' },
              name: { type: 'string', description: 'The idea, as a short claim.' },
              claim: { type: 'string', description: 'The claim in one or two sentences.' },
              note_title: { type: 'string', description: 'The title of the note it is from.' },
              quote: { type: 'string', description: 'The words in that note it is taken from.' },
              mastery: MASTERY_TOOL_FIELD,
              kind: KIND_TOOL_FIELD,
            },
            required: ['name', 'claim', 'note_title', 'quote'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages: [{ role: 'user', content: lines.join('\n') }],
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Reading the notes failed.',
    };
  }

  input.onSpend?.({ model: MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') {
    return { ok: false, reason: 'error', detail: whyNoReport(response) };
  }

  const parsed = payloadSchema.safeParse(block.input);
  if (!parsed.success) {
    return { ok: false, reason: 'error', detail: 'The idea came back in the wrong shape.' };
  }
  const report = parsed.data;
  if (report.none) {
    return { ok: false, reason: 'nothing-in-it', detail: 'Those notes hold no claim to test.' };
  }

  const reported = {
    name: report.name.trim(),
    claim: report.claim.trim(),
    noteTitle: report.note_title.trim(),
    quote: report.quote.trim(),
  };
  const why = whyUngrounded(reported, source, input.existing);
  if (why) return { ok: false, reason: 'ungrounded', detail: why };

  const note = source.notes.find((n) => folded(n.title) === folded(reported.noteTitle))!;
  return {
    ok: true,
    idea: {
      ...reported,
      noteTitle: note.title,
      basis: `From your note "${note.title}": "${reported.quote}"`,
      mastery: report.mastery.length > 0 ? report.mastery : null,
      kind: report.kind,
    },
  };
}

function fail(action: string, error: { message: string }): Error {
  return new Error(`${action} failed: ${error.message}`);
}

/**
 * The theme, its about line and up to `SURVEY_NOTES_READ` of its notes still
 * in the vault, most recently changed first. Null when the theme is not yours
 * or is gone. `notes` is empty when nothing is linked to it.
 */
export async function loadSurveySource(
  vault: VaultSupabaseClient,
  themeId: string,
): Promise<SurveySource | null> {
  const [themeRead, notesRead] = await Promise.all([
    vault.from('themes').select('id, name, about').eq('id', themeId).maybeSingle(),
    vault
      .from('notes')
      .select('title, body, theme_notes!inner(theme_id)')
      .eq('theme_notes.theme_id', themeId)
      .is('deleted_at', null)
      .order('git_updated_at', { ascending: false, nullsFirst: false })
      .limit(SURVEY_NOTES_READ),
  ]);
  if (themeRead.error) throw fail('Reading the theme', themeRead.error);
  if (notesRead.error) throw fail("Reading the theme's notes", notesRead.error);
  if (!themeRead.data) return null;

  const theme = themeRead.data as { id: string; name: string; about: string };
  const notes = ((notesRead.data ?? []) as { title: string; body: string }[])
    .filter((note) => note.body.trim() !== '')
    .map((note) => ({ title: note.title, body: note.body }));
  return { theme, notes };
}

/** The names of the ideas already in a survey subject, oldest first. */
export async function loadSurveyIdeaNames(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('concepts')
    .select('name')
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: true });
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw fail('Reading the ideas already written for that theme', error);
  return ((data ?? []) as { name: string }[]).map((row) => row.name);
}

export type WrittenSurveyIdea =
  | { ok: true; subjectId: string; conceptId: string; idea: SurveyIdea }
  | {
      ok: false;
      /**
       * `gone`: the theme is not yours or no longer exists. `no-notes`: nothing
       * in the vault is linked to it. `tracked`: it already has a real track.
       * The rest are from the model call, as in `IdeaResult`.
       */
      reason: 'gone' | 'no-notes' | 'tracked' | 'nothing-in-it' | 'ungrounded' | 'error';
      detail: string;
    };

/**
 * Write one new idea for a survey question about `themeId`.
 *
 * In order: read the theme and its notes, and stop if there are none; find or
 * make the theme's survey subject, and stop if the theme has a real track;
 * ask for an idea that is not one of those already in the subject; insert it.
 * Each call writes a new idea. Reusing one already written is the caller's
 * choice, from `loadSurveyIdeaNames` or the subject's concepts.
 *
 * Spend is reported through `onSpend`; record it as 'write-survey-idea'.
 */
export async function writeSurveyIdea(input: {
  supabase: LearnSupabaseClient;
  vault: VaultSupabaseClient;
  userId: string;
  themeId: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<WrittenSurveyIdea> {
  const source = await loadSurveySource(input.vault, input.themeId);
  if (!source)
    return { ok: false, reason: 'gone', detail: 'That theme is no longer in your notes.' };
  if (source.notes.length === 0) {
    return {
      ok: false,
      reason: 'no-notes',
      detail: `No notes are linked to "${source.theme.name}".`,
    };
  }

  const subject = await surveySubjectForTheme(input.supabase, input.userId, source.theme);
  if (!subject) {
    return { ok: false, reason: 'tracked', detail: `"${source.theme.name}" already has a track.` };
  }

  const existing = await loadSurveyIdeaNames(input.supabase, subject.id);
  const result = await ideaFromThemeNotes({
    source,
    existing,
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
  if (!result.ok) return result;

  const { idea } = result;
  const { data, error } = await input.supabase
    .from('concepts')
    .insert({
      user_id: input.userId,
      subject_id: subject.id,
      name: idea.name,
      claim: idea.claim,
      basis: idea.basis,
      origin: 'reading',
      mastery: idea.mastery,
      kind: idea.kind,
    })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) throw fail('Writing the idea', error ?? { message: 'no row' });

  return { ok: true, subjectId: subject.id, conceptId: (data as { id: string }).id, idea };
}
