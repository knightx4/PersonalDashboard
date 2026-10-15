'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { readBrief } from '@/lib/learn/essays/model';
import { loadPlanContext, savePlanJson } from '@/lib/learn/essays/store';
import { GUIDE_MODEL, guideCall, runPointEvidence } from '@/lib/learn/essays/guide-model';
import { evidencePrompt } from '@/lib/learn/essays/evidence';
import { logEssayCall, logEssayStageVisit } from '@/lib/learn/essays/log-store';
import { askPlan, readbackPlan } from '@/lib/learn/essays/guide-run';
import {
  FIND_POINTS_SYSTEM,
  findPointsPrompt,
  plainShapes,
  readFoundPoints,
  readReview,
  readShapes,
  REVIEW_SYSTEM,
  reviewPrompt,
  SHAPES_SYSTEM,
  shapesPrompt,
} from '@/lib/learn/essays/guide';
import {
  answeredPoint,
  closedReview,
  DIG_KINDS,
  editedPoint,
  editedPointNote,
  movedPoint,
  NOTE_MAX,
  ownWords,
  planJson,
  POINT_MAX,
  readPlan,
  ROLES,
  shapedPlan,
  THESIS_MAX,
  withoutPoint,
  withPoint,
  withReadbackReply,
  withReview,
  withTake,
  withThesis,
  withEvidence,
  withEvidenceTake,
  withoutEvidence,
  EVIDENCE_KINDS,
  STAGES,
  type EvidenceKind,
  type EssayPlan,
  type Shape,
} from '@/lib/learn/essays/plan';

/**
 * The guided essay's actions (docs/LEARN-ESSAYS-SPEC.md, "The stages").
 *
 * The person's own changes to the plan go through `changeEssayPlan`, one
 * small change at a time, each read against the stored plan so two tabs do
 * not undo each other's points. The rest each make one Sonnet call, recorded
 * in the Learn spend ledger, and either change the plan (the read of the
 * brief, the notes on the plan, the next question about a point) or offer
 * something the person then chooses from (points found in their own words,
 * shapes for the essay).
 */

export type PlanResult = { ok: true; plan: EssayPlan } | { ok: false; error: string };

const Id = z.string().uuid();

function noKey(): { ok: false; error: string } {
  return { ok: false, error: 'Dash needs the Anthropic key, which is not set on this deployment.' };
}

async function context(id: string) {
  const supabase = await createLearnClient();
  const row = await loadPlanContext(supabase, id);
  if (!row) return null;
  return { supabase, brief: readBrief(row.brief), plan: readPlan(row.plan) };
}

const Change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thesis'), text: z.string().max(THESIS_MAX * 2) }),
  z.object({
    kind: z.literal('reply'),
    index: z.number().int().min(0).max(10),
    text: z.string().max(NOTE_MAX * 2),
  }),
  z.object({
    kind: z.literal('take'),
    key: z.string().min(1).max(120),
    text: z.string().max(NOTE_MAX * 2),
  }),
  z.object({
    kind: z.literal('add'),
    text: z.string().max(POINT_MAX * 2),
    role: z.enum(ROLES).optional(),
  }),
  z.object({
    kind: z.literal('edit'),
    point: z.string().min(1).max(64),
    text: z
      .string()
      .max(POINT_MAX * 2)
      .optional(),
    role: z.enum(ROLES).optional(),
    ready: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('remove'), point: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal('move'),
    point: z.string().min(1).max(64),
    by: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({
    kind: z.literal('note'),
    point: z.string().min(1).max(64),
    index: z.number().int().min(0).max(20),
    text: z.string().max(NOTE_MAX * 2),
  }),
  z.object({ kind: z.literal('close-review'), note: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('drop-evidence'), point: z.string().min(1).max(64), evidence: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal('evidence-take'),
    point: z.string().min(1).max(64),
    evidence: z.string().min(1).max(64),
    text: z.string().max(NOTE_MAX * 2),
  }),
  z.object({
    kind: z.literal('shape'),
    shape: z.object({
      name: z.string().min(1).max(120),
      why: z.string().max(400),
      parts: z
        .array(
          z.object({
            role: z.enum(ROLES),
            guide: z.string().max(300),
            points: z.array(z.string().max(64)).max(20),
          }),
        )
        .min(1)
        .max(12),
    }),
  }),
]);

export type PlanChange = z.infer<typeof Change>;

function applied(plan: EssayPlan, change: PlanChange): EssayPlan {
  switch (change.kind) {
    case 'thesis':
      return withThesis(plan, change.text);
    case 'reply':
      return withReadbackReply(plan, change.index, change.text);
    case 'take':
      return withTake(plan, change.key, change.text);
    case 'add':
      return withPoint(plan, change.text, change.role);
    case 'edit':
      return editedPoint(plan, change.point, change);
    case 'remove':
      return withoutPoint(plan, change.point);
    case 'move':
      return movedPoint(plan, change.point, change.by);
    case 'note':
      return editedPointNote(plan, change.point, change.index, change.text);
    case 'close-review':
      return closedReview(plan, change.note);
    case 'drop-evidence':
      return withoutEvidence(plan, change.point, change.evidence);
    case 'evidence-take':
      return withEvidenceTake(plan, change.point, change.evidence, change.text);
    case 'shape':
      return shapedPlan(plan, change.shape as Shape);
  }
}

/** One change the person made to their plan, in their own words. */
// latency: optimistic
export async function changeEssayPlan(id: string, change: PlanChange): Promise<PlanResult> {
  await requireUser();
  const parsedId = Id.safeParse(id);
  const parsed = Change.safeParse(change);
  if (!parsedId.success || !parsed.success)
    return { ok: false, error: 'Could not keep that change.' };
  try {
    const now = await context(parsedId.data);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const plan = readPlan(planJson(applied(now.plan, parsed.data)));
    await savePlanJson(now.supabase, parsedId.data, planJson(plan));
    return { ok: true, plan };
  } catch (error) {
    console.error('[essay plan]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not keep that change. Try again in a moment.' };
  }
}

/** Dash reads the brief again, with the person's replies to the last read. */
// latency: pending
export async function readEssayBrief(id: string): Promise<PlanResult> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    if (!now.brief.question.trim() && !now.brief.claim.trim()) {
      return {
        ok: false,
        error: 'Answer at least the question and your answer first; Dash reads those.',
      };
    }
    const spend = collectSpend();
    const read = await readbackPlan({
      brief: now.brief,
      plan: now.plan,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'read-essay-brief', spend.reports);
    if (!read.ok) {
      console.error('[essay readback]', read.detail);
      return { ok: false, error: 'Dash could not read the brief just now. Try again in a moment.' };
    }
    await savePlanJson(now.supabase, id, planJson(read.plan));
    return { ok: true, plan: read.plan };
  } catch (error) {
    console.error('[essay readback]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not read the brief just now. Try again in a moment.' };
  }
}

export type FoundPointsResult = { ok: true; found: string[] } | { ok: false; error: string };

/**
 * Points found in what the person already wrote: their brief answers, their
 * replies to Dash and their takes on the research. Only passages that are
 * there word for word come back, and none is saved until they choose it.
 */
// latency: pending
export async function findEssayPoints(id: string): Promise<FoundPointsResult> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const sources = ownWords(now.brief, now.plan);
    if (sources.length === 0) {
      return {
        ok: false,
        error:
          'There is nothing of yours to look through yet. Answer the interview or note your take on the research first.',
      };
    }
    const spend = collectSpend();
    const reply = await guideCall({
      system: FIND_POINTS_SYSTEM,
      prompt: findPointsPrompt(now.brief, sources, now.plan.points),
      maxTokens: 1_200,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'find-essay-points', spend.reports);
    if (!reply.ok) {
      console.error('[essay points]', reply.detail);
      return {
        ok: false,
        error: 'Dash could not look through your writing just now. Try again in a moment.',
      };
    }
    return { ok: true, found: readFoundPoints(reply.text, sources, now.plan.points) };
  } catch (error) {
    console.error('[essay points]', error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: 'Dash could not look through your writing just now. Try again in a moment.',
    };
  }
}

export type ShapesResult =
  | { ok: true; shapes: Shape[]; fromDash: boolean }
  | { ok: false; error: string };

/**
 * Two or three shapes the essay could take, built around the person's
 * points. Nothing changes until they choose one. Without the key, or when
 * Dash's reply cannot be read, the three plain shapes are offered instead.
 */
// latency: pending
export async function shapeEssayPlan(id: string): Promise<ShapesResult> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  try {
    const now = await context(id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    if (now.plan.points.filter((p) => p.text.trim()).length < 2) {
      return {
        ok: false,
        error:
          'Write at least two points on the Plan step first; the shapes are built around them.',
      };
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: true, shapes: plainShapes(now.plan), fromDash: false };
    const spend = collectSpend();
    const reply = await guideCall({
      system: SHAPES_SYSTEM,
      prompt: shapesPrompt(now.brief, now.plan),
      maxTokens: 1_500,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'shape-essay-plan', spend.reports);
    const shapes = reply.ok ? readShapes(reply.text, now.plan) : [];
    if (shapes.length === 0) {
      console.error('[essay shapes]', reply.ok ? 'no shape could be read' : reply.detail);
      return { ok: true, shapes: plainShapes(now.plan), fromDash: false };
    }
    return { ok: true, shapes, fromDash: true };
  } catch (error) {
    console.error('[essay shapes]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not suggest shapes just now. Try again in a moment.' };
  }
}

/** Dash's notes on the plan as it stands: the biggest problems, each ending in a question. */
// latency: pending
export async function reviewEssayPlan(id: string): Promise<PlanResult & { clean?: boolean }> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { ok: false, error: 'Could not find that essay.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    if (now.plan.points.length === 0)
      return { ok: false, error: 'Add a point or two first; Dash reads the plan.' };
    const spend = collectSpend();
    const reply = await guideCall({
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt(now.brief, now.plan),
      maxTokens: 800,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'review-essay-plan', spend.reports);
    if (!reply.ok) {
      console.error('[essay review]', reply.detail);
      return { ok: false, error: 'Dash could not read the plan just now. Try again in a moment.' };
    }
    const notes = readReview(reply.text);
    const plan = withReview(now.plan, notes);
    await savePlanJson(now.supabase, id, planJson(plan));
    return { ok: true, plan, clean: notes.length === 0 };
  } catch (error) {
    console.error('[essay review]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not read the plan just now. Try again in a moment.' };
  }
}

const PointInput = z.object({
  id: Id,
  point: z.string().min(1).max(64),
  kind: z.enum(DIG_KINDS).nullable(),
});

/** Dash's next question about one point, of the kind the person picked or the next in turn. */
// latency: pending
export async function askEssayPoint(
  id: string,
  point: string,
  kind: string | null,
): Promise<PlanResult> {
  const user = await requireUser();
  const parsed = PointInput.safeParse({ id, point, kind });
  if (!parsed.success) return { ok: false, error: 'Could not ask about that point.' };
  try {
    const now = await context(parsed.data.id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const spend = collectSpend();
    const plan = await askPlan({
      brief: now.brief,
      plan: now.plan,
      pointId: parsed.data.point,
      kind: parsed.data.kind,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'word-point-question', spend.reports);
    await savePlanJson(now.supabase, parsed.data.id, planJson(plan));
    return { ok: true, plan };
  } catch (error) {
    console.error('[essay dig]', error instanceof Error ? error.message : error);
    return {
      ok: false,
      error: 'Dash could not ask about that point just now. Try again in a moment.',
    };
  }
}

const AnswerInput = z.object({
  id: Id,
  point: z.string().min(1).max(64),
  answer: z
    .string()
    .max(NOTE_MAX * 2, 'That is long for one answer; keep it to a paragraph or two.'),
  more: z.boolean(),
});

/**
 * The person's answer to the question about a point, kept under it in their
 * words. With `more`, Dash asks the next question straight away, so the
 * conversation carries on; without it, the point is left with its notes.
 */
// latency: pending
export async function answerEssayPoint(
  id: string,
  point: string,
  answer: string,
  more: boolean,
): Promise<PlanResult> {
  const user = await requireUser();
  const parsed = AnswerInput.safeParse({ id, point, answer, more });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Could not keep that answer.' };
  try {
    const now = await context(parsed.data.id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    let plan = answeredPoint(now.plan, parsed.data.point, parsed.data.answer);
    if (parsed.data.more) {
      const spend = collectSpend();
      plan = await askPlan({
        brief: now.brief,
        plan,
        pointId: parsed.data.point,
        kind: null,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        onSpend: spend.sink,
      });
      await recordLearnSpend(user.id, 'word-point-question', spend.reports);
    }
    await savePlanJson(now.supabase, parsed.data.id, planJson(plan));
    return { ok: true, plan };
  } catch (error) {
    console.error('[essay dig]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Could not keep that answer. Try again in a moment.' };
  }
}

const EvidenceInput = z.object({
  id: Id,
  point: z.string().min(1).max(64),
  kind: z.enum(EVIDENCE_KINDS),
});

export type EvidenceActionResult = { ok: true; plan: EssayPlan; found: number } | { ok: false; error: string };

/**
 * Evidence of one kind for one point (LEARN-ESSAYS-SPEC, "Evidence on a
 * point"): one narrow search, up to three cited items, kept on the point.
 * The response is logged as it came back, so the tests can replay it.
 */
// latency: pending
export async function findPointEvidence(id: string, point: string, kind: string): Promise<EvidenceActionResult> {
  const user = await requireUser();
  const parsed = EvidenceInput.safeParse({ id, point, kind });
  if (!parsed.success) return { ok: false, error: 'Could not search for that.' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return noKey();
  try {
    const now = await context(parsed.data.id);
    if (!now) return { ok: false, error: 'That essay is not there any more.' };
    const target = now.plan.points.find((p) => p.id === parsed.data.point);
    if (!target || !target.text.trim()) return { ok: false, error: 'Write the point first; the search is built on it.' };
    const prompt = evidencePrompt({
      question: now.brief.question,
      thesis: now.plan.thesis || now.brief.claim,
      reader: now.brief.reader,
      point: target.text,
      kind: parsed.data.kind as EvidenceKind,
    });
    const spend = collectSpend();
    const result = await runPointEvidence({
      prompt,
      kind: parsed.data.kind as EvidenceKind,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(user.id, 'find-point-evidence', spend.reports);
    if (!result.ok) {
      console.error('[essay evidence]', result.detail);
      return { ok: false, error: 'Dash could not search just now. Try again in a moment.' };
    }
    await logEssayCall(now.supabase, user.id, parsed.data.id, {
      stage: 'develop',
      action: 'find-point-evidence',
      kind: parsed.data.kind,
      model: GUIDE_MODEL,
      prompt,
      content: result.content,
    });
    const plan = withEvidence(now.plan, target.id, result.items);
    await savePlanJson(now.supabase, parsed.data.id, planJson(plan));
    return { ok: true, plan, found: result.items.length };
  } catch (error) {
    console.error('[essay evidence]', error instanceof Error ? error.message : error);
    return { ok: false, error: 'Dash could not search just now. Try again in a moment.' };
  }
}

/** A stage was opened: one row, so where people stop is visible. */
// latency: instant
export async function logEssayStage(id: string, stage: string): Promise<void> {
  const user = await requireUser();
  const parsed = z.object({ id: Id, stage: z.enum(STAGES) }).safeParse({ id, stage });
  if (!parsed.success) return;
  try {
    const supabase = await createLearnClient();
    await logEssayStageVisit(supabase, user.id, parsed.data.id, parsed.data.stage);
  } catch (error) {
    console.error('[essay log]', error instanceof Error ? error.message : error);
  }
}
