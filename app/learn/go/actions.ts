'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadNextItem } from '@/lib/learn/next/choose-store';
import type { NextItem } from '@/lib/learn/next/choose';
import { placeLine, type SessionItem, type SessionMode, type SessionStep } from '@/lib/learn/next/session';
import { markLessonShown } from '@/lib/learn/next/session-store';
import { loadPieceIdea, loadPieceRow } from '@/lib/learn/lessons/piece-store';
import { loadPieceStanding } from '@/lib/learn/lessons/practice-store';
import { askCell } from '@/lib/learn/levels/answer-store';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { countAnswered, loadRunDoubts } from '@/lib/learn/levels/practice-store';
import { roleWhy } from '@/lib/learn/levels/role-line';
import { roleLineFinder } from '@/lib/learn/levels/role-match';
import { runSummary, type RunSummary } from '@/lib/learn/levels/run';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { markLevelLessonRead } from '@/lib/learn/levels/level-lesson-store';
import { writeLevelLesson } from '@/inngest/learn/level-lesson';
import { askReview } from '@/app/learn/review/actions';
import { askPieceCheck, writeLessonForPiece, writePiecePractice } from '@/app/learn/s/[id]/p/[piece]/actions';

/**
 * A learning session's reads and writes (plan #2546.3). The session asks for
 * the next item while the one before it is on screen, so whatever it needs
 * written (a review question, a lesson, a check, a practice task, a level
 * question) is written here, before Next is pressed, through the same
 * actions the piece's page, the review list and Practice use.
 */

type Learn = Awaited<ReturnType<typeof createLearnClient>>;

const Keys = z.array(z.string().min(1).max(200)).max(500);

function failed(item: NextItem, error: string): SessionItem {
  return { kind: 'failed', key: item.key, line: placeLine(item), was: item.kind, error };
}

/**
 * The item with what its screen draws, `failed` with why it could not be
 * written, or null for one to pass over without showing: a level whose
 * lesson the writer would not teach goes straight to its question.
 */
async function prepare(learn: Learn, userId: string, item: NextItem): Promise<SessionItem | null> {
  const line = placeLine(item);
  switch (item.kind) {
    case 'review': {
      if (item.review.open) return { kind: 'review', key: item.key, line, review: item.review };
      const asked = await askReview(item.review.conceptId);
      if (!asked.question) return failed(item, asked.error ?? 'The review question could not be written.');
      return { kind: 'review', key: item.key, line, review: { ...item.review, open: asked.question } };
    }
    case 'lesson': {
      const place = { subjectId: item.subjectId, pieceId: item.pieceId };
      const [piece, found] = await Promise.all([
        loadPieceRow(learn, userId, item.subjectId, item.pieceId),
        loadPieceIdea(learn, userId, item.conceptId),
      ]);
      let idea = found;
      if (!idea?.lesson) {
        const written = await writeLessonForPiece(item.subjectId, item.pieceId, item.conceptId);
        if (!written.ok) return failed(item, written.detail);
        idea = written.idea;
      }
      if (!idea.lesson) return failed(item, idea.dropped ?? 'No lesson could be written for this idea.');
      const at = piece?.concept_ids.indexOf(item.conceptId) ?? -1;
      return { ...place, kind: 'lesson', key: item.key, line, idea, number: at >= 0 ? at + 1 : 1 };
    }
    case 'check': {
      const place = { subjectId: item.subjectId, pieceId: item.pieceId };
      const [asked, standing] = await Promise.all([
        askPieceCheck(item.subjectId, item.pieceId),
        loadPieceStanding(learn, userId, item.pieceId),
      ]);
      if (!asked.check) return failed(item, asked.error ?? 'The check could not be written.');
      // The level a check asks about goes on the line, as the card in a session leaves out its own.
      const on = asked.check.cell;
      return {
        ...place,
        kind: 'check',
        key: item.key,
        line: on ? `${line} · ${on.topicName}, level ${on.level}` : line,
        check: asked.check,
        practicePassed: standing.practicePassed,
      };
    }
    case 'task': {
      const place = { subjectId: item.subjectId, pieceId: item.pieceId };
      const [written, standing] = await Promise.all([
        writePiecePractice(item.subjectId, item.pieceId),
        loadPieceStanding(learn, userId, item.pieceId),
      ]);
      if (!written.practice) return failed(item, written.error ?? 'The practice task could not be written.');
      return { ...place, kind: 'task', key: item.key, line, practice: written.practice, checkPassed: standing.checkPassed };
    }
    case 'question': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const spend = collectSpend();
      const asked = await askCell(
        learn,
        userId,
        item.cell.cellId,
        apiKey ? { anthropicApiKey: apiKey, onSpend: spend.sink } : undefined,
        undefined,
        roleLineFinder(learn, userId),
      );
      await recordLearnSpend(userId, 'write-cell-case', spend.reports);
      if (!asked.ok) return failed(item, asked.error);
      const why = [item.why, asked.asked.role ? roleWhy(asked.asked.role) : null].filter(Boolean).join(' ');
      return { kind: 'question', key: item.key, line, asked: { ...asked.asked, why } };
    }
    case 'level_lesson': {
      const written = await writeLevelLesson(userId, item.cell.cellId);
      if (!written.ok) return failed(item, written.detail);
      const { lesson } = written;
      if (!lesson.lesson) return null;
      return { kind: 'level_lesson', key: item.key, line, lesson: { ...lesson, lesson: lesson.lesson } };
    }
    default: {
      const unknown: never = item;
      return failed(unknown, 'This kind of item cannot be shown yet.');
    }
  }
}

/**
 * The next item to learn, written and ready to show. `skip` is every key the
 * session has shown, so it moves on rather than handing one back. Called as
 * each item shows, for the one after it; no button starts it. A Quick learn
 * session (`mode` lessons) is given lessons only.
 */
// latency: pending
export async function nextSessionItem(skip: string[], mode: SessionMode = 'all'): Promise<SessionStep> {
  const user = await requireUser();
  const keys = Keys.safeParse(skip);
  if (!keys.success) return { ok: false, error: 'Could not tell what this session has shown.' };
  const learn = await createLearnClient();
  const skipped = new Set(keys.data);
  // A few tries: an item passed over without showing is skipped and the next chosen.
  for (let tries = 0; tries < PASS_OVER_TRIES; tries++) {
    let item: NextItem | null;
    try {
      item = await loadNextItem(learn, user.id, { skip: skipped, mode: mode === 'lessons' ? 'lessons' : 'all' });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Choosing what to learn next failed.' };
    }
    if (!item) return { ok: true, item: null };
    const chosen = item;
    const ready = await prepare(learn, user.id, chosen).catch((error: unknown) =>
      failed(chosen, error instanceof Error ? error.message : 'It could not be written.'),
    );
    if (ready) return { ok: true, item: ready };
    skipped.add(chosen.key);
  }
  return { ok: false, error: 'Nothing could be made ready to show. Try again in a moment.' };
}

/** Items passed over without showing before the session says so. */
const PASS_OVER_TRIES = 4;

/** A lesson the session showed counts as read, so the next one comes after it. */
// latency: optimistic
export async function markSessionLessonRead(conceptId: string): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(conceptId);
  if (!id.success) return;
  await markLessonShown(await createLearnClient(), user.id, id.data).catch(() => undefined);
}

/** A level's lesson the session showed counts as read, so the level's question comes next. */
// latency: optimistic
export async function markSessionLevelLessonRead(lessonId: string): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(lessonId);
  if (!id.success) return;
  await markLevelLessonRead(await createLearnClient(), user.id, id.data).catch(() => undefined);
}

export type SessionEndResult = { summary: RunSummary } | { error: string };

/** What the session's answers moved on the topic ladders since it started, as a Practice run's end shows. */
// latency: pending
export async function endSession(startedAt: string): Promise<SessionEndResult> {
  const user = await requireUser();
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return { error: 'Could not tell when this session started.' };
  const since = new Date(Math.min(t, Date.now())).toISOString();
  try {
    const learn = await createLearnClient();
    const map = await loadGradeMap(learn, user.id);
    const [answered, doubted] = await Promise.all([
      countAnswered(learn, user.id, since),
      loadRunDoubts(learn, user.id, since, map),
    ]);
    return { summary: runSummary({ map, since, answered, doubted }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Reading what moved failed.' };
  }
}
