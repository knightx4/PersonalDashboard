import { isUuid } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import { retryBriefFor } from '@/lib/learn/briefs/retry';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { makeCustomSubject, writeSubjectCurriculum } from '@/lib/learn/graph/curriculum-run';
import { loadSubject } from '@/lib/learn/graph/load';
import { addUnit } from '@/lib/learn/lessons/plan-edit';
import { planOwnerFor } from '@/lib/learn/lessons/plan-store';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { approveDraftedTopic } from '@/lib/learn/briefs/topics-store';
import { addToSubjectLens } from '@/lib/learn/levels/lens-store';
import { settleWanted } from '@/lib/learn/levels/store';
import { writeQuizQuestionsFor } from '@/lib/learn/quiz/write-run';
import { summarizeReadingFor } from '@/lib/learn/tracks/summarize-run';
import type { DashPaidCheckContext, DashPaidPrepared, DashPaidTool } from './registry';

/**
 * Dash's paid tools in Learn (plan #2228.4, under #2228): the Learn buttons
 * that spend money and make sense asked for in words. Each one is queued on a
 * card with its estimate and runs, once approved, through the function its
 * button's server action calls (`runs`), as lib/dash/paid-tools.ts says.
 *
 * The Learn buttons that spend and have no tool here say why in their
 * catalogue entries (lib/learn/agent-actions.ts): a press that returns a
 * proposal for the page to tick, a question or mark that is the person's own
 * study, a press inside the essay editor, or work that starts itself as a
 * page opens.
 */

const QUEUED =
  'It costs money, so calling this runs nothing: it is queued on a card under your answer with its estimated cost, and runs only when they approve it.';

type Input = Record<string, unknown>;

const inputOf = (input: unknown): Input => (input && typeof input === 'object' ? (input as Input) : {});

const text = (input: Input, key: string): string => (typeof input[key] === 'string' ? (input[key] as string).trim() : '');

async function learnOf(ctx: { db: DashPaidCheckContext['db'] }): Promise<LearnSupabaseClient> {
  return (await ctx.db('learn')) as unknown as LearnSupabaseClient;
}

/** The row's own column, or null when the id names nothing of theirs. */
async function rowOf(
  learn: LearnSupabaseClient,
  table: 'subjects' | 'topics' | 'readings' | 'briefs' | 'quizzes',
  id: string,
  column: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await learn.from(table).select(`id, ${column}`).eq('id', id).maybeSingle();
  if (error) throw new Error(`Reading learn.${table} failed: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

const NO_KEY: DashPaidPrepared = {
  ok: false,
  error: 'This deployment has no Anthropic API key set, so Dash cannot run this.',
};

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** New topic on Topics, a goal named on a subject, and a wanted topic drafted from a draft's page. */
const draftTopicTool: DashPaidTool = {
  name: 'draft_topic',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/topics/actions.ts#draftTopicFromGoal',
  runs: 'lib/learn/levels/draft-run.ts#runTopicDraft',
  workspace: 'learn',
  definition: {
    name: 'draft_topic',
    description: `Draft a Learn topic with its ten levels, approved as soon as it is drafted when every row cites a source (otherwise kept as a draft on its page), when they name something they want to know (one topic, such as DCF or Braess's paradox). Pass subject_id to add it to that subject's lens, or for_topic_id when it is a topic another topic's links want. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What they want to know, as one topic, under 300 characters.' },
        scope: { type: 'string', description: 'Optional: what the topic should cover, when they said.' },
        subject_id: { type: 'string', description: 'Optional: the learn.subjects id whose lens the topic joins.' },
        for_topic_id: {
          type: 'string',
          description: 'Optional: the learn.topics id whose wanted list names this topic; the levels that wanted it are linked to the draft.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const args = inputOf(input);
    const name = text(args, 'name');
    if (name.length < 2) return { ok: false, error: 'Name what they want to know.' };
    if (name.length > 300) return { ok: false, error: 'Name one topic, in under 300 characters.' };
    if (!hasKey()) return NO_KEY;
    const scope = text(args, 'scope').slice(0, 1000) || null;
    const subjectId = text(args, 'subject_id') || null;
    const forTopicId = text(args, 'for_topic_id') || null;
    const learn = await learnOf(ctx);
    let subject: string | null = null;
    if (subjectId) {
      const row = isUuid(subjectId) ? await rowOf(learn, 'subjects', subjectId, 'name') : null;
      if (!row) return { ok: false, error: 'That subject is not one of theirs.' };
      subject = String(row.name);
    }
    if (forTopicId) {
      const row = isUuid(forTopicId) ? await rowOf(learn, 'topics', forTopicId, 'name') : null;
      if (!row) return { ok: false, error: 'The topic that wants this one is not one of theirs.' };
    }
    return {
      ok: true,
      args: { name, scope, subjectId, forTopicId },
      line: subject ? `Draft the topic ${name}, for ${subject}.` : `Draft the topic ${name}.`,
      paths: ['/learn/topics', ...(forTopicId ? [`/learn/topics/${forTopicId}`] : []), ...(subjectId ? ['/learn/know'] : [])],
    };
  },
  async run(ctx, args) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: 'Drafting a topic needs ANTHROPIC_API_KEY to be set.' };
    const learn = await learnOf(ctx);
    const name = String(args.name);
    const result = await runTopicDraft(learn, ctx.userId, {
      goal: name,
      scope: typeof args.scope === 'string' ? args.scope : null,
      anthropicApiKey: apiKey,
    });
    if (!result.ok) return { ok: false, error: result.detail };
    if (typeof args.forTopicId === 'string') {
      await settleWanted(learn, ctx.userId, { topicId: args.forTopicId, name, draftId: result.id });
    }
    // The draft is kept even if this fails: it is on the map and can be added again.
    if (typeof args.subjectId === 'string') {
      await addToSubjectLens(learn, ctx.userId, args.subjectId, result.id).catch((error: unknown) =>
        console.error('[dash draft_topic] subject lens', error instanceof Error ? error.message : error),
      );
    }
    // The draft is kept even if approving fails: its page still has Approve.
    const approval = await approveDraftedTopic(learn, ctx.userId, result.id).catch((error: unknown) => {
      console.error('[dash draft_topic] approve', error instanceof Error ? error.message : error);
      return null;
    });
    return {
      ok: true,
      subjectRef: toRef('learn.topics', result.id),
      op: 'insert',
      summary: !approval?.approved
        ? `Dash drafted the topic ${name}, kept as a draft on its page because approving it failed.`
        : approval.personal > 0
          ? `Dash drafted and approved the topic ${name}, with ${approval.personal} ${approval.personal === 1 ? 'row' : 'rows'} that name no source marked personal.`
          : `Dash drafted and approved the topic ${name}.`,
    };
  },
};

/** Make a subject on Subjects: a subject by name, with its curriculum. */
const makeSubjectTool: DashPaidTool = {
  name: 'make_learn_subject',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/know/actions.ts#createCustomTrack',
  runs: 'lib/learn/graph/curriculum-run.ts#makeCustomSubject',
  workspace: 'learn',
  definition: {
    name: 'make_learn_subject',
    description: `Make a Learn subject by name with its curriculum written by a model, placed among the areas, when they ask to start learning a subject. Their own units, if they gave them, are kept in their order. A name they already have goes to that subject. A reading list with no model run is add_learn_track. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The subject, under 80 characters.' },
        want: { type: 'string', description: 'Optional: what they want out of it, a sentence or two.' },
        units: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: the units they named, in their order.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  async prepare(_ctx, input) {
    const args = inputOf(input);
    const name = text(args, 'name');
    if (name.length < 2) return { ok: false, error: 'Name the subject.' };
    if (name.length > 80) return { ok: false, error: 'Keep the name under 80 characters; say the rest in what they want from it.' };
    const want = text(args, 'want');
    if (want.length > 500) return { ok: false, error: 'Say what they want from it in under 500 characters.' };
    const units = Array.isArray(args.units)
      ? args.units.filter((unit): unit is string => typeof unit === 'string' && unit.trim().length > 0).map((unit) => unit.trim())
      : [];
    if (units.join('\n').length > 4000) return { ok: false, error: 'The units are too long to keep; name each in a few words.' };
    return {
      ok: true,
      args: { name, want: want || null, units: units.join('\n') },
      line: units.length
        ? `Make the subject ${name} with your ${units.length} units.`
        : `Make the subject ${name} and write its curriculum.`,
      paths: ['/learn/know'],
    };
  },
  async run(ctx, args) {
    const learn = await learnOf(ctx);
    const name = String(args.name);
    const made = await makeCustomSubject(learn, ctx.userId, {
      name,
      want: typeof args.want === 'string' ? args.want : null,
      units: typeof args.units === 'string' ? args.units : '',
    });
    if (!made.ok) return { ok: false, error: made.detail };
    const written = !made.curriculum.ok
      ? 'no curriculum yet, which its page offers to write'
      : made.curriculum.units.length === 0
        ? 'its opening units to be written as it is prepared'
        : `${made.curriculum.units.length} units`;
    return {
      ok: true,
      subjectRef: toRef('learn.subjects', made.id),
      op: made.created ? 'insert' : 'update',
      summary: made.created ? `Dash made the subject ${name}, with ${written}.` : `You already had ${name}; it has ${written}.`,
    };
  },
};

/** Write the curriculum, on a subject that has none. */
const writeCurriculumTool: DashPaidTool = {
  name: 'write_subject_curriculum',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/s/[id]/actions.ts#writeTrackCurriculum',
  runs: 'lib/learn/graph/curriculum-run.ts#writeSubjectCurriculum',
  workspace: 'learn',
  definition: {
    name: 'write_subject_curriculum',
    description: `Write the curriculum of a Learn subject that has none, from the question it was started for. A subject that already has one keeps it. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: { subject_id: { type: 'string', description: 'The learn.subjects id.' } },
      required: ['subject_id'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const subjectId = text(inputOf(input), 'subject_id');
    const learn = await learnOf(ctx);
    const row = isUuid(subjectId) ? await rowOf(learn, 'subjects', subjectId, 'name') : null;
    if (!row) return { ok: false, error: 'That subject is not one of theirs.' };
    return {
      ok: true,
      args: { subjectId },
      line: `Write the curriculum of ${String(row.name)}.`,
      paths: [`/learn/s/${subjectId}`],
    };
  },
  async run(ctx, args) {
    const result = await writeSubjectCurriculum(await learnOf(ctx), ctx.userId, String(args.subjectId));
    if (!result.ok) return { ok: false, error: result.detail };
    return {
      ok: true,
      subjectRef: toRef('learn.subjects', result.subject.id),
      op: 'update',
      summary: result.written
        ? `Dash wrote the curriculum of ${result.subject.name}: ${result.units} units.`
        : `${result.subject.name} already had its curriculum, so it stays as it was.`,
    };
  },
};

/** Add a unit, on a learning goal's plan. */
const addPlanUnitTool: DashPaidTool = {
  name: 'add_plan_unit',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/s/[id]/actions.ts#addUnitToPlan',
  runs: 'lib/learn/lessons/plan-edit.ts#addUnit',
  workspace: 'learn',
  definition: {
    name: 'add_plan_unit',
    description: `Add a unit by name to the end of a learning goal's plan, described by a model before it is kept. Only a subject that is a learning goal's plan takes one. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: {
        subject_id: { type: 'string', description: "The learn.subjects id of the goal's plan." },
        title: { type: 'string', description: 'The unit, in a few words.' },
      },
      required: ['subject_id', 'title'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const args = inputOf(input);
    const subjectId = text(args, 'subject_id');
    const title = text(args, 'title');
    if (!title) return { ok: false, error: 'Name the unit.' };
    const learn = await learnOf(ctx);
    const goal = isUuid(subjectId) ? await planOwnerFor(learn, ctx.userId, subjectId) : null;
    if (!goal) return { ok: false, error: 'Only the plan of a goal or a prepared subject can take a unit.' };
    return {
      ok: true,
      args: { subjectId, title },
      line: `Add the unit ${title} to the plan for ${goal.name}.`,
      paths: [`/learn/s/${subjectId}`, '/learn/now'],
    };
  },
  async run(ctx, args) {
    const learn = await learnOf(ctx);
    const subjectId = String(args.subjectId);
    const subject = await loadSubject(learn, subjectId);
    if (!subject || !(await planOwnerFor(learn, ctx.userId, subjectId))) {
      return { ok: false, error: 'That plan could not be found.' };
    }
    const result = await addUnit(learn, ctx.userId, subject, String(args.title));
    if (!result.ok) return { ok: false, error: result.detail };
    return {
      ok: true,
      subjectRef: toRef('learn.subjects', subject.id),
      op: 'update',
      summary: `Dash added the unit ${String(args.title)} to the plan for ${subject.name}.`,
    };
  },
};

/** Summarize, and Redo, on a reading's page. */
const summarizeReadingTool: DashPaidTool = {
  name: 'summarize_reading',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/r/[id]/actions.ts#summarizeReading',
  runs: 'lib/learn/tracks/summarize-run.ts#summarizeReadingFor',
  workspace: 'learn',
  definition: {
    name: 'summarize_reading',
    description: `Summarize a reading on one of their lists from its text, or write its summary again, kept on the reading's page. A reading whose link cannot be read needs its text pasted first. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: { reading_id: { type: 'string', description: 'The learn.readings id.' } },
      required: ['reading_id'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const readingId = text(inputOf(input), 'reading_id');
    const row = isUuid(readingId) ? await rowOf(await learnOf(ctx), 'readings', readingId, 'subject') : null;
    if (!row) return { ok: false, error: 'That reading is not one of theirs.' };
    if (!hasKey()) return NO_KEY;
    return {
      ok: true,
      args: { readingId },
      line: `Summarize ${String(row.subject)}.`,
      paths: [`/learn/r/${readingId}`],
    };
  },
  async run(ctx, args) {
    const result = await summarizeReadingFor(await learnOf(ctx), ctx.userId, String(args.readingId));
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      subjectRef: toRef('learn.readings', String(args.readingId)),
      op: 'update',
      summary: `Dash summarized ${result.title}.`,
    };
  },
};

/** Try again, on a research brief whose run failed. */
const retryBriefTool: DashPaidTool = {
  name: 'retry_research_brief',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/b/[id]/actions.ts#retryBrief',
  runs: 'lib/learn/briefs/retry.ts#retryBriefFor',
  workspace: 'learn',
  definition: {
    name: 'retry_research_brief',
    description: `Start the research again on a brief whose run failed. A brief that is researching or done is left alone; a new question is research_topic. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: { brief_id: { type: 'string', description: 'The learn.briefs id.' } },
      required: ['brief_id'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const briefId = text(inputOf(input), 'brief_id');
    const row = isUuid(briefId) ? await rowOf(await learnOf(ctx), 'briefs', briefId, 'question, status') : null;
    if (!row) return { ok: false, error: 'That brief is not one of theirs.' };
    if (row.status !== 'failed') return { ok: false, error: 'Only a brief whose run failed can be started again.' };
    return {
      ok: true,
      args: { briefId },
      line: `Start the research again on the brief “${String(row.question)}”.`,
      paths: [`/learn/b/${briefId}`, '/learn/now'],
    };
  },
  async run(ctx, args) {
    const briefId = String(args.briefId);
    const result = await retryBriefFor(await learnOf(ctx), ctx.userId, briefId);
    if (!result.ok) return { ok: false, error: result.error };
    if (!result.restarted) return { ok: false, error: 'That brief is not failed any more, so nothing was started.' };
    return {
      ok: true,
      subjectRef: toRef('learn.briefs', briefId),
      op: 'update',
      summary: 'Dash started the research on the brief again; its page fills in as it runs.',
    };
  },
};

/** Write the questions, on a quiz that has none. */
const writeQuizTool: DashPaidTool = {
  name: 'write_quiz_questions',
  kind: 'paid',
  inAppOnly: true,
  action: 'app/learn/quiz/[id]/actions.ts#writeQuestions',
  runs: 'lib/learn/quiz/write-run.ts#writeQuizQuestionsFor',
  workspace: 'learn',
  definition: {
    name: 'write_quiz_questions',
    description: `Write the questions of a quiz that has none, from the material it is over. A quiz that has its questions keeps them. ${QUEUED}`,
    input_schema: {
      type: 'object',
      properties: { quiz_id: { type: 'string', description: 'The learn.quizzes id.' } },
      required: ['quiz_id'],
      additionalProperties: false,
    },
  },
  async prepare(ctx, input) {
    const quizId = text(inputOf(input), 'quiz_id');
    const row = isUuid(quizId) ? await rowOf(await learnOf(ctx), 'quizzes', quizId, 'title') : null;
    if (!row) return { ok: false, error: 'That quiz is not one of theirs.' };
    if (!hasKey()) return NO_KEY;
    return {
      ok: true,
      args: { quizId },
      line: `Write the questions for the quiz ${String(row.title)}.`,
      paths: [`/learn/quiz/${quizId}`],
    };
  },
  async run(ctx, args) {
    const result = await writeQuizQuestionsFor(await learnOf(ctx), ctx.userId, String(args.quizId));
    if (!result.ok) return { ok: false, error: result.error ?? result.message ?? 'Dash could not write the questions.' };
    return {
      ok: true,
      subjectRef: toRef('learn.quizzes', result.quizId),
      op: 'update',
      summary: `Dash wrote ${result.written} questions for the quiz ${result.title}.`,
    };
  },
};

/** The Learn paid tools, in the order the model is sent them. */
export const LEARN_PAID_TOOLS: readonly DashPaidTool[] = [
  draftTopicTool,
  makeSubjectTool,
  writeCurriculumTool,
  addPlanUnitTool,
  summarizeReadingTool,
  retryBriefTool,
  writeQuizTool,
];
