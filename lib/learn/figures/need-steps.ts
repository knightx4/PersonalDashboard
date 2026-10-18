import type { SupabaseClient } from '@supabase/supabase-js';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { goalTrackIds } from '@/lib/learn/feed/plan-lessons';
import { addsAsProposal, dashStamp } from '@/lib/plan/origin';
import { nextPlanPosition } from '@/lib/plan/position';
import type { PlanScope } from '@/lib/plan/projects';
import type { FigureNeed } from './kinds/wanted';

/**
 * A figure the lessons keep asking for becomes a plan step (plan #2321.10).
 *
 * A stage of the daily cron reads learn.figure_need_groups (`./needs.ts`
 * groups the asks). A group asked for by `ASKED_TO_FILE` lessons, or by one
 * lesson in a subject with an active goal on it, gets one build step under
 * the figures feature, written as the plan skill's shaping rules ask: a
 * title saying what will be true, a first sentence for the person, the
 * registry entry, gallery surface and test it must carry, and a done-when
 * naming the lessons waiting on it. It is stamped as Dash's and goes in
 * ready to build under an approved feature, a proposal under one still
 * proposed, where auto approve takes it like any proposal.
 *
 * learn.figure_need_steps links the group's key to the step. A group with a
 * link is never filed again, so a later lesson asking for the same figure
 * adds to the group's count and the step stays one. A group under the
 * threshold waits for its next ask.
 */

/** The feature the steps go under: #2321, lessons carry figures from a registry of kinds. */
export const FIGURE_FEATURE_NUMBER = 2321;

/** How many lessons must ask for a figure before it is built, outside a subject with a goal. */
export const ASKED_TO_FILE = 2;

/** Lessons named in a step's done-when; the rest are counted. */
const NAMED_LESSONS = 5;

const MAX_TITLE_CHARS = 140;

export type NeedGroup = {
  key: string;
  need: FigureNeed;
  shows: string;
  why: string;
  caption: string;
  asked: number;
  cardIds: string[];
  subjectIds: string[];
};

/** A lesson that asked, as a step names it. */
export type WaitingLesson = { cardId: string; name: string; subject: string | null };

/** Whether a group is asked for often enough, or by a subject with a goal, to be built. */
export function shouldFile(group: Pick<NeedGroup, 'asked' | 'subjectIds'>, goalSubjects: ReadonlySet<string>): boolean {
  return group.asked >= ASKED_TO_FILE || group.subjectIds.some((id) => goalSubjects.has(id));
}

/** A data source or a figure kind is a sitting's work; a model or a map layer is more. */
export function needStepSize(need: FigureNeed): 's' | 'm' {
  return need === 'model' || need === 'map_layer' ? 'm' : 's';
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sentence(text: string): string {
  const line = oneLine(text);
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/** Lower-cases the first letter unless the first word is an acronym (GDP, UK). */
function lowerFirst(text: string): string {
  if (/^[A-Z][a-z]/.test(text) || /^[A-Z]\s/.test(text)) return text[0].toLowerCase() + text.slice(1);
  return text;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
}

/** What working the step adds, by what is missing. */
const CONTRACT: Record<FigureNeed, { thing: string; build: string }> = {
  figure_kind: {
    thing: 'The new figure kind',
    build:
      'Add one figure kind: a file in lib/learn/figures/kinds/ exporting a FigureKind (id, label, schema, writer line, example and Render), listed in FIGURE_KINDS in lib/learn/figures/registry.ts before wanted; a gallery surface learn-figure-<id> in app/preview/surfaces.tsx that draws its example; and a test that reads the example through readWrittenFigures and renders it with Figure.',
  },
  data_source: {
    thing: 'The new data source',
    build:
      'Add one data source: an entry in DATA_SOURCE_IDS and DATA_SOURCES in lib/learn/figures/sources.ts that says how a series is named and fetches one with no key; a gallery surface learn-figure-chart-<id> in app/preview/surfaces.tsx that draws a chart of one of its series; and a test that reads a recorded response into a yearly series.',
  },
  model: {
    thing: 'The new explorable model',
    build:
      'Add one explorable model: a file in lib/learn/figures/models/ to the contract in models/types.ts, appended to EXPLORABLE_MODELS in models/registry.ts; a gallery surface learn-figure-explorable-<id> in app/preview/surfaces.tsx; and its case in models/registry.test.tsx.',
  },
  map_layer: {
    thing: 'The new map layer',
    build:
      'Add one map layer: its field in the map kind’s schema and writer line in lib/learn/figures/kinds/map.tsx, drawn by map-view.tsx; a gallery surface learn-figure-map-<layer> in app/preview/surfaces.tsx; and its case in lib/learn/figures/map.test.tsx.',
  },
};

function lessonName(lesson: WaitingLesson): string {
  return lesson.subject ? `“${lesson.name}” in ${lesson.subject}` : `“${lesson.name}”`;
}

function namedLessons(lessons: readonly WaitingLesson[], asked: number): string {
  const named = lessons.slice(0, NAMED_LESSONS).map(lessonName);
  const rest = Math.max(asked, lessons.length) - named.length;
  if (named.length === 0) return `the ${asked === 1 ? 'lesson' : `${asked} lessons`} that asked`;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/** The step as Dash writes it: title, detail, done-when and size. */
export function needStepRow(
  group: NeedGroup,
  lessons: readonly WaitingLesson[],
  goalSubjectNames: readonly string[] = [],
): { title: string; detail: string; acceptance: string; size: 's' | 'm' } {
  const shows = oneLine(group.shows).replace(/[.]+$/, '');
  const title = clip(`Lessons can show ${lowerFirst(shows)}`, MAX_TITLE_CHARS);
  const contract = CONTRACT[group.need];

  const who =
    group.asked >= ASKED_TO_FILE
      ? `${group.asked} lessons asked`
      : goalSubjectNames.length > 0
        ? `A lesson in ${goalSubjectNames[0]}, a subject with a goal on it, asked`
        : 'A lesson asked';
  const waiting = namedLessons(lessons, group.asked);

  const detail = [
    `${who} for a figure the app cannot draw yet: ${sentence(shows)} ${sentence(group.why)}`,
    contract.build,
    'Change nothing outside lib/learn/figures and the gallery (app/preview/surfaces.tsx, lib/preview/routes.ts): the lesson writer, the store and the page read the registry, so the entry reaches all three.',
    `Lessons waiting on it: ${waiting}. Their figure need is ${group.key} in learn.figure_need_groups, and once this is built those lessons get the figure (plan #2321.11).`,
  ].join('\n\n');

  const acceptance = `${contract.thing} is registered, its gallery surface draws it, its test passes, and the lesson writer can give it to the lessons waiting on it: ${waiting}.`;

  return { title, detail, acceptance, size: needStepSize(group.need) };
}

/** One row of learn.figure_need_groups as PostgREST returns it. */
type GroupRow = {
  key: string;
  need: FigureNeed;
  shows: string;
  why: string;
  caption: string;
  asked: number;
  card_ids: string[] | null;
  subject_ids: string[] | null;
};

export type FiledStep = { key: string; planItemId: string; number: number | null; title: string };

export type FileNeedStepsResult = {
  users: { userId: string; filed: FiledStep[]; waiting: number; error?: string }[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PublicDb = SupabaseClient<any, 'public'>;

/** The statuses above a feature, nearest first: the feature's own, then its parents'. */
async function chainStatuses(plan: PublicDb, userId: string, start: { status: string; parent_id: string | null }): Promise<string[]> {
  const statuses = [start.status];
  let parent = start.parent_id;
  for (let depth = 0; parent && depth < 10; depth += 1) {
    const { data } = await plan.from('plan_items').select('status, parent_id').eq('user_id', userId).eq('id', parent).maybeSingle();
    const row = data as { status: string; parent_id: string | null } | null;
    if (!row) break;
    statuses.push(row.status);
    parent = row.parent_id;
  }
  return statuses;
}

/**
 * Files a step for every group due one, for each account that has the
 * figures feature. One account's failure is reported and the next still runs.
 */
export async function fileFigureNeedSteps(input: {
  learn: LearnSupabaseClient;
  plan: PublicDb;
  now?: Date;
}): Promise<FileNeedStepsResult> {
  const { learn, plan } = input;
  const date = (input.now ?? new Date()).toISOString().slice(0, 10);

  const { data: features, error } = await plan
    .from('plan_items')
    .select('id, user_id, module, status, parent_id')
    .eq('number', FIGURE_FEATURE_NUMBER)
    .is('dismissed_at', null)
    .neq('status', 'dropped');
  if (error) throw new Error(`Reading the figures feature failed: ${error.message}`);

  const users: FileNeedStepsResult['users'] = [];
  for (const feature of (features ?? []) as { id: string; user_id: string; module: string | null; status: string; parent_id: string | null }[]) {
    const userId = feature.user_id;
    const filed: FiledStep[] = [];
    try {
      const groups = await learn
        .from('figure_need_groups')
        .select('key, need, shows, why, caption, asked, card_ids, subject_ids')
        .eq('user_id', userId)
        .is('plan_item_id', null)
        .order('first_asked_at', { ascending: true });
      if (groups.error) throw new Error(`Reading figure needs failed: ${groups.error.message}`);
      const unfiled: NeedGroup[] = ((groups.data ?? []) as GroupRow[]).map((row) => ({
        key: row.key,
        need: row.need,
        shows: row.shows,
        why: row.why,
        caption: row.caption,
        asked: row.asked,
        cardIds: row.card_ids ?? [],
        subjectIds: row.subject_ids ?? [],
      }));
      if (unfiled.length === 0) {
        users.push({ userId, filed, waiting: 0 });
        continue;
      }

      const goalSubjects = new Set(await goalTrackIds(learn, userId));
      const due = unfiled.filter((group) => shouldFile(group, goalSubjects));
      if (due.length === 0) {
        users.push({ userId, filed, waiting: unfiled.length });
        continue;
      }

      const cardIds = [...new Set(due.flatMap((group) => group.cardIds))];
      const cards = await learn
        .from('feed_cards')
        .select('id, idea_name, named_section, hook, track_name, subject_id')
        .eq('user_id', userId)
        .in('id', cardIds);
      if (cards.error) throw new Error(`Reading the lessons that asked failed: ${cards.error.message}`);
      const cardRows = (cards.data ?? []) as {
        id: string;
        idea_name: string | null;
        named_section: string | null;
        hook: string | null;
        track_name: string | null;
        subject_id: string | null;
      }[];
      const lessonOf = new Map(
        cardRows.map((card) => [
          card.id,
          {
            cardId: card.id,
            name: clip(oneLine(card.idea_name || card.named_section || card.hook || 'A lesson'), 80),
            subject: card.track_name ? oneLine(card.track_name) : null,
          } satisfies WaitingLesson,
        ]),
      );
      const subjectName = new Map(cardRows.filter((c) => c.subject_id && c.track_name).map((c) => [c.subject_id as string, oneLine(c.track_name as string)]));

      const proposed = addsAsProposal(await chainStatuses(plan, userId, feature), false);
      const scope = feature.module as PlanScope | null;

      for (const group of due) {
        const lessons = group.cardIds.map((id) => lessonOf.get(id)).filter((l): l is WaitingLesson => Boolean(l));
        const goalNames = group.subjectIds.filter((id) => goalSubjects.has(id)).map((id) => subjectName.get(id) ?? 'a subject');
        const row = needStepRow(group, lessons, goalNames);
        const position = await nextPlanPosition(plan, userId, scope, feature.id);
        const inserted = await plan
          .from('plan_items')
          .insert({
            user_id: userId,
            module: feature.module,
            parent_id: feature.id,
            title: row.title,
            detail: row.detail,
            acceptance: row.acceptance,
            kind: 'build',
            priority: 2,
            size: row.size,
            status: proposed ? 'proposed' : 'not_started',
            position,
            comment: dashStamp(date),
          })
          .select('id, number')
          .single();
        if (inserted.error || !inserted.data) throw new Error(`Writing the step for a figure need failed: ${inserted.error?.message ?? 'no row'}`);
        const step = inserted.data as { id: string; number: number | null };

        const linked = await learn
          .from('figure_need_steps')
          .insert({ user_id: userId, key: group.key, plan_item_id: step.id, asked: group.asked });
        if (linked.error) {
          // Linked by a run that got there first, or not linked at all: either
          // way this step would be a second one, so it is dropped with why.
          await plan
            .from('plan_items')
            .update({ status: 'dropped', comment: `${dashStamp(date)}\nDropped by Dash: its figure need could not be linked (${linked.error.message}).` })
            .eq('user_id', userId)
            .eq('id', step.id);
          throw new Error(`Linking the step for a figure need failed: ${linked.error.message}`);
        }
        filed.push({ key: group.key, planItemId: step.id, number: step.number, title: row.title });
      }
      users.push({ userId, filed, waiting: unfiled.length - due.length });
    } catch (err) {
      users.push({ userId, filed, waiting: 0, error: err instanceof Error ? err.message : 'failed' });
    }
  }
  return { users };
}
