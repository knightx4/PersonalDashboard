import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendSink } from '@/lib/core/spend/pricing';
import {
  asksForDraft,
  nextInterviewQuestion,
  type InterviewBackground,
  type InterviewNote,
  type InterviewQuestion,
} from '@/lib/dash/interview';
import { draftFromInterview, type InterviewDrafts } from '@/lib/dash/interview-draft';
import { MODULES, moduleForPath } from '@/lib/modules';
import { MAX_CHANGED_LINES } from './changes';
import {
  draftCandidates,
  draftFits,
  draftVisionNote,
  draftWhy,
  interviewCitation,
  newSpecTarget,
  specChangeHref,
  specDraftDiff,
  visionDraftHref,
  type DraftTarget,
} from './interview-draft';
import {
  addInterviewTurn,
  finishSpecInterview,
  loadSpecInterview,
  nextMove,
  requestInterviewDraft,
  type SpecInterview,
} from './interviews';
import { readSpec, SPECS } from './registry';
import { APP_VISION, type VisionScope } from './vision';
import { writeVisionReview } from './vision-review';

/**
 * The interview's moves as a server action makes them (plan #1639): Dash
 * asking its next question, and the person answering; and when the questions
 * end, Dash drafting the vision and the spec (plan #1640, draftInterview). Each reads the
 * interview fresh and checks whose move it is, so a double press or a second
 * tab cannot ask twice or answer a question that was never asked.
 *
 * The model call is lib/dash/interview.ts on the shared Dash loop. What it
 * spends is handed to `onSpend`; the caller records it under the core
 * operation 'ask-dash', since this is Dash's loop answering what the person
 * typed and adds no conversational model path of its own.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

/** How far back the notes and the page opens are read. */
export const BACKGROUND_DAYS = 90;
/** The most notes the brief lists. */
export const BACKGROUND_NOTES = 12;
/** The most notes read to find them, newest first, before sorting by workspace. */
const NOTES_SCANNED = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Job search", or "the app as a whole". */
export function scopeLabel(scope: VisionScope): string {
  if (scope === APP_VISION) return 'the app as a whole';
  return MODULES.find((module) => module.id === scope)?.label ?? scope;
}

/**
 * What is already written about a workspace: its vision, its specs (the text
 * for a workspace's own, the blurb for the app's, which run long and are about
 * how the app is built), recent notes filed on its pages, and its page opens.
 * A part that cannot be read is left out rather than failing the question.
 */
export async function loadInterviewBackground(
  client: AnyClient,
  userId: string,
  scope: VisionScope,
  now: number = Date.now(),
): Promise<InterviewBackground> {
  const since = new Date(now - BACKGROUND_DAYS * DAY_MS).toISOString();
  const isApp = scope === APP_VISION;
  const specDocs = SPECS.filter((spec) => (isApp ? spec.module === null : spec.module === scope));

  const [vision, notes, opens, specs] = await Promise.all([
    client
      .from('module_visions')
      .select('body')
      .eq('user_id', userId)
      .eq('module', scope)
      .maybeSingle()
      .then(({ data }) => ((data as { body: string } | null)?.body ?? null)),
    client
      .from('feedback_items')
      .select('kind, body, page_path, created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(NOTES_SCANNED)
      .then(({ data, error }) => {
        if (error) return [];
        return ((data ?? []) as { kind: string; body: string; page_path: string | null; created_at: string }[])
          .filter((row) => (moduleForPath(row.page_path) ?? APP_VISION) === scope)
          .slice(0, BACKGROUND_NOTES)
          .map((row): InterviewNote => ({
            kind: row.kind,
            body: row.body,
            pagePath: row.page_path,
            createdAt: row.created_at,
          }));
      }),
    readOpens(client, userId, scope, since),
    Promise.all(
      specDocs.map(async (spec) => ({
        title: spec.title,
        text: isApp ? spec.blurb : ((await readSpec(spec)) ?? spec.blurb),
      })),
    ),
  ]);

  return { label: scopeLabel(scope), vision, specs, notes, opens };
}

async function readOpens(
  client: AnyClient,
  userId: string,
  scope: VisionScope,
  since: string,
): Promise<InterviewBackground['opens']> {
  try {
    const core = client.schema('core');
    const [counted, first] = await Promise.all([
      core.rpc('workspace_opens', { p_user_id: userId, p_since: since }),
      core.from('page_view_days').select('day').eq('user_id', userId).limit(1),
    ]);
    if (counted.error) return null;
    const rows = (counted.data ?? []) as { workspace: string | null; opens: number; pages: number }[];
    const mine = rows.find((row) => (row.workspace ?? APP_VISION) === scope);
    const recorded = rows.length > 0 || (first.data ?? []).length > 0;
    return { days: BACKGROUND_DAYS, opens: mine?.opens ?? 0, pages: mine?.pages ?? 0, recorded };
  } catch {
    return null;
  }
}

/** What asking came to, with the new turn's id when a question was kept. */
export type AskedInterviewQuestion =
  | (Extract<InterviewQuestion, { kind: 'question' }> & { turnId: string })
  | Exclude<InterviewQuestion, { kind: 'question' }>;

/**
 * Dash's next question in an interview of the account's, kept in its thread.
 * Asks nothing when it is not Dash's move: after the last question allowed,
 * after "draft it now", or while a question waits for its answer.
 */
export async function askInterviewQuestion(
  client: AnyClient,
  userId: string,
  interviewId: string,
  deps: {
    anthropicApiKey: string;
    /** YYYY-MM-DD in the person's timezone. */
    today: string;
    onSpend?: SpendSink;
    anthropic?: Anthropic;
  },
): Promise<AskedInterviewQuestion> {
  const interview = await loadSpecInterview(client, userId, interviewId);
  if (!interview) return { kind: 'failed', detail: 'That interview is not one of yours, or it is no longer there.' };
  const move = nextMove(interview);
  if (move !== 'ask') return { kind: 'stop', move };

  const background = await loadInterviewBackground(client, userId, interview.module);
  const asked = await nextInterviewQuestion({
    interview,
    background,
    today: deps.today,
    anthropicApiKey: deps.anthropicApiKey,
    client: deps.anthropic,
    onSpend: deps.onSpend,
  });
  if (asked.kind !== 'question') return asked;
  const turnId = await addInterviewTurn(client, userId, {
    interviewId,
    author: 'claude',
    body: asked.question,
  });
  return { ...asked, turnId };
}

/**
 * The person's answer to the question waiting in an interview of theirs. An
 * answer that only asks for the draft ("draft it now") asks for it instead of
 * being kept. Returns the interview as it now stands, whose nextMove says
 * what happens next: 'ask' for another question, 'draft' once the questions
 * have ended.
 */
export async function answerInterview(
  client: AnyClient,
  userId: string,
  interviewId: string,
  body: string,
): Promise<SpecInterview> {
  const interview = await loadSpecInterview(client, userId, interviewId);
  if (!interview) throw new Error('That interview is not one of yours, or it is no longer there.');
  if (asksForDraft(body)) {
    await requestInterviewDraft(client, userId, interviewId);
  } else {
    if (nextMove(interview) !== 'answer') throw new Error('There is no question waiting for an answer.');
    await addInterviewTurn(client, userId, { interviewId, author: 'me', body });
  }
  const after = await loadSpecInterview(client, userId, interviewId);
  if (!after) throw new Error('That interview is no longer there.');
  return after;
}

/** What drafting came to. */
export type DraftedInterview =
  | {
      kind: 'drafted';
      /** The pending edit in vision_reviews, under the vision on /dev/specs. */
      visionReviewId: string;
      /** The proposed change in spec_changes, under "Changes to specs". */
      specChangeId: string;
      /** The spec it goes into, by slug; a new one when `newSpec`. */
      spec: string;
      newSpec: boolean;
      /** Where each lands on the specs page. */
      visionHref: string;
      specChangeHref: string;
      /** True when the vision edit took the place of one the weekly review proposed. */
      foldedVisionEdit: boolean;
    }
  /** Not time to draft: a question is waiting ('answer'), more can be asked ('ask'), or it has finished (null). */
  | { kind: 'stop'; move: 'ask' | 'answer' | null }
  | { kind: 'failed'; detail: string };

type PendingEdit = { id: string; proposed_body: string | null; created_at: string };

/**
 * Draft the vision and the spec from an interview whose questions have ended
 * (nextMove 'draft'), and finish it as drafted (plan #1640).
 *
 * The vision goes in as a pending edit in vision_reviews under the
 * interview's id as its review_id, beside the current vision with the accept
 * and dismiss the weekly review's edits have. A workspace holds one pending
 * edit, so when the weekly review has one waiting the draft takes its place:
 * that row is rewritten with the drafted text, which the model was given the
 * old proposal to fold in, rather than dismissed, since dismissing is the
 * person's move.
 *
 * The spec goes in as a proposed spec_changes row, made by Dash, whatever
 * else is waiting: the person asked for this one, so the weekly audit's cap
 * of five does not apply. It is held to the 60-line limit; a draft over it is
 * asked for once more, shorter, and then refused.
 *
 * One model call, two when the first draft runs long: about thirty seconds to
 * a minute in all. Spend goes to `onSpend`, which the caller records under
 * 'ask-dash' as it does the questions.
 */
export async function draftInterview(
  client: AnyClient,
  userId: string,
  interviewId: string,
  deps: {
    anthropicApiKey: string;
    /** YYYY-MM-DD in the person's timezone. */
    today: string;
    onSpend?: SpendSink;
    anthropic?: Anthropic;
  },
): Promise<DraftedInterview> {
  const interview = await loadSpecInterview(client, userId, interviewId);
  if (!interview) return { kind: 'failed', detail: 'That interview is not one of yours, or it is no longer there.' };
  const move = nextMove(interview);
  if (move !== 'draft') return { kind: 'stop', move };

  const scope = interview.module;
  const candidates = draftCandidates(scope, SPECS);
  const created = candidates.length === 0 ? newSpecTarget(scope, SPECS) : null;

  if (created) {
    const { data: waiting } = await client
      .from('spec_changes')
      .select('id')
      .eq('user_id', userId)
      .eq('spec', created.slug)
      .in('status', ['proposed', 'approved'])
      .limit(1);
    if ((waiting ?? []).length > 0) {
      return {
        kind: 'failed',
        detail: `A new spec for ${scopeLabel(scope)} is already waiting on the specs page. Approve or decline it before Dash drafts another.`,
      };
    }
  }

  const [background, pending] = await Promise.all([
    loadInterviewBackground(client, userId, scope),
    client
      .from('vision_reviews')
      .select('id, proposed_body, created_at')
      .eq('user_id', userId)
      .eq('module', scope)
      .eq('status', 'pending')
      .maybeSingle()
      .then(({ data }) => (data as PendingEdit | null) ?? null),
  ]);

  // The specs it may go into, read whole: the background's copies are cut short.
  const texts = new Map<string, string | null>();
  for (const candidate of candidates) {
    const doc = SPECS.find((spec) => spec.slug === candidate.slug);
    texts.set(candidate.slug, doc ? await readSpec(doc) : null);
  }

  const heading = scope === APP_VISION ? 'The app as a whole' : scopeLabel(scope);
  let retry: string | null = null;
  let drafted: { drafts: InterviewDrafts; diff: string; target: DraftTarget } | null = null;
  for (let attempt = 0; attempt < 2 && !drafted; attempt++) {
    const result = await draftFromInterview({
      interview,
      background,
      candidates,
      pendingVision: pending?.proposed_body ?? null,
      retry,
      today: deps.today,
      anthropicApiKey: deps.anthropicApiKey,
      client: deps.anthropic,
      onSpend: deps.onSpend,
    });
    if (result.kind === 'failed') return result;
    const target = created ?? candidates.find((c) => c.slug === result.drafts.spec) ?? candidates[0];
    const markdown = created ? null : (texts.get(target.slug) ?? null);
    if (!created && markdown === null) {
      return { kind: 'failed', detail: `The spec ${target.file} could not be read, so nothing was drafted.` };
    }
    const diff = specDraftDiff({ target, markdown, heading, draft: result.drafts });
    const fits = draftFits(diff);
    if (fits.ok) {
      drafted = { drafts: result.drafts, diff, target };
    } else {
      retry =
        `Your last draft came to ${fits.lines} changed lines, and the limit is ${MAX_CHANGED_LINES}, ` +
        'blank lines and headings included. Write it again, shorter: fewer sections, shorter bodies, fewer rules.';
    }
  }
  if (!drafted) {
    return { kind: 'failed', detail: `Dash's spec ran over the ${MAX_CHANGED_LINES}-line limit twice, so nothing was drafted.` };
  }

  const citation = interviewCitation(scopeLabel(scope), deps.today);
  const { data: change, error: changeError } = await client
    .from('spec_changes')
    .insert({
      user_id: userId,
      spec: drafted.target.slug,
      title: drafted.drafts.title,
      why: draftWhy(citation, drafted.drafts.why),
      diff: drafted.diff,
      made_by: 'claude',
    })
    .select('id')
    .single();
  if (changeError || !change) {
    return { kind: 'failed', detail: `The spec could not be kept: ${changeError?.message ?? 'nothing was written'}.` };
  }
  const specChangeId = (change as { id: string }).id;
  const undoChange = () => client.from('spec_changes').delete().eq('id', specChangeId).eq('user_id', userId);

  const note = draftVisionNote({ citation, why: drafted.drafts.visionWhy, foldedFrom: pending?.created_at ?? null });
  let visionReviewId: string;
  if (pending) {
    const { data, error } = await client
      .from('vision_reviews')
      .update({
        review_id: interview.id,
        session_id: null,
        vision_body: background.vision,
        proposed_body: drafted.drafts.vision,
        note,
      })
      .eq('id', pending.id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select('id');
    if (error || (data ?? []).length === 0) {
      await undoChange();
      return {
        kind: 'failed',
        detail: `The vision could not be kept: ${error?.message ?? 'the edit waiting there was decided meanwhile'}. Try again.`,
      };
    }
    visionReviewId = pending.id;
  } else {
    const written = await writeVisionReview(client as SupabaseClient, userId, {
      module: scope,
      reviewId: interview.id,
      visionBody: background.vision,
      note,
      outcome: 'edit',
      proposedBody: drafted.drafts.vision,
      evidenceIds: [],
    });
    if ('error' in written) {
      await undoChange();
      return { kind: 'failed', detail: `The vision could not be kept: ${written.error}. Try again.` };
    }
    visionReviewId = written.id;
  }

  try {
    await finishSpecInterview(client, userId, interview.id, {
      status: 'drafted',
      summary: drafted.drafts.summary,
      visionReviewId,
      specChangeId,
    });
  } catch (error) {
    // Another press drafted it first: keep that one's drafts, not these.
    await undoChange();
    return { kind: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }

  return {
    kind: 'drafted',
    visionReviewId,
    specChangeId,
    spec: drafted.target.slug,
    newSpec: created !== null,
    visionHref: visionDraftHref(scope),
    specChangeHref: specChangeHref(specChangeId),
    foldedVisionEdit: pending !== null,
  };
}
