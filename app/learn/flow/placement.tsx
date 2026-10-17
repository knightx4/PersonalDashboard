import { redirect } from 'next/navigation';
import { CellAnswer } from '@/components/learn/cell-answer';
import { PlacementEndView } from '@/components/learn/placement-end-view';
import { NoTopicToPlace, PracticeError } from '@/components/learn/practice-states';
import { createLearnClient } from '@/lib/learn/auth/server';
import { practiceHref } from '@/lib/learn/flow/href';
import { askCell } from '@/lib/learn/levels/answer-store';
import type { GradeMap } from '@/lib/learn/levels/grade';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { readCells } from '@/lib/learn/levels/model';
import { whyLine } from '@/lib/learn/levels/pick';
import {
  firstNotHeld,
  heldPieces,
  inTeachingOrder,
  pickPlacement,
  placedTopics,
  placementOrder,
  PLACEMENT_QUESTIONS,
  type PlacementPiece,
} from '@/lib/learn/levels/placement';
import { loadLensOrder, loadPlacementPieces, passPlacedPieces } from '@/lib/learn/levels/placement-store';
import { countAnswered } from '@/lib/learn/levels/practice-store';
import { roleLineFinder } from '@/lib/learn/levels/role-match';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * A placement before a subject's first lesson (plan #2292.2): a Practice Flow
 * run on the subject's lens that only places you, up to eight questions,
 * taking the topics in the order the lessons teach them (lib/learn/levels/
 * placement.ts). Answers go through Practice Flow's own action, so they write
 * evidence and move the lens as any practice answer does.
 *
 * Every question carries Skip to the lesson. The end, reached by the eighth
 * answer, by running out of levels to place or by Skip, passes every piece of
 * the laid-out units whose matched cells are all held, with a reason of
 * placement, and opens on the first piece left. Skip goes straight there;
 * the end otherwise shows the levels and the pieces first.
 */

type Learn = Awaited<ReturnType<typeof createLearnClient>>;

/** A time the flow wrote itself; anything else starts a new run. */
function runTime(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) || t > Date.now() ? null : new Date(t).toISOString();
}

function pieceHref(subjectId: string, pieceId: string): string {
  return `/learn/s/${subjectId}/p/${pieceId}`;
}

/** Pass the pieces now held, and say where the lessons start. */
async function finish(learn: Learn, userId: string, subjectId: string, map: GradeMap, pieces: PlacementPiece[]) {
  const passedIds = new Set(await passPlacedPieces(learn, userId, heldPieces(pieces, readCells(map))));
  const after = pieces.map((p) => (passedIds.has(p.id) ? { ...p, passed: true } : p));
  const first = firstNotHeld(after);
  return {
    passed: inTeachingOrder(pieces.filter((p) => passedIds.has(p.id))).map((p) => p.title),
    lesson: first ? { title: first.title, href: pieceHref(subjectId, first.id) } : null,
  };
}

export async function PlacementFlow({
  userId,
  subject,
  run: runParam,
  end: endParam,
  skip,
}: {
  userId: string;
  subject: { id: string; name: string };
  run?: string | string[];
  end?: string | string[];
  skip?: boolean;
}) {
  const scope = { track: subject.id, placement: true };
  const subjectHref = `/learn/s/${subject.id}`;
  const learn = await createLearnClient();
  const now = new Date();

  let map: GradeMap;
  let order: string[];
  let pieces: PlacementPiece[];
  try {
    const [loaded, lensTopics, laidOut] = await Promise.all([
      loadGradeMap(learn, userId),
      loadLensOrder(learn, userId, subject.id),
      loadPlacementPieces(learn, userId, subject.id),
    ]);
    map = loaded;
    pieces = laidOut;
    order = placementOrder(lensTopics, laidOut, new Map(loaded.cells.map((c) => [c.id, c.topicId])));
  } catch (error) {
    return (
      <PracticeError
        message={error instanceof Error ? error.message : 'Reading your topics failed.'}
        retryHref={practiceHref(scope)}
      />
    );
  }

  const run = runTime(runParam);
  const end = runTime(endParam);
  let asked = 0;
  if (!end && run) {
    try {
      asked = await countAnswered(learn, userId, run);
    } catch (error) {
      return (
        <PracticeError
          message={error instanceof Error ? error.message : 'Counting your answers failed.'}
          retryHref={practiceHref({ ...scope, run })}
        />
      );
    }
  }
  const picked = end ? null : pickPlacement(map, { order, now, asked });

  if (!picked) {
    if (!end && !run && order.length === 0) return <NoTopicToPlace subjectName={subject.name} />;
    const since = end ?? run ?? now.toISOString();
    const done = await finish(learn, userId, subject.id, map, pieces).then(
      (d) => ({ ok: true as const, ...d }),
      (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : 'Passing the pieces failed.' }),
    );
    if (!done.ok) return <PracticeError message={done.message} retryHref={practiceHref({ ...scope, end: since })} />;
    if (skip) redirect(done.lesson?.href ?? subjectHref);
    return (
      <PlacementEndView
        topics={placedTopics(map, readCells(map), order, since)}
        passed={done.passed}
        lesson={done.lesson}
        subjectHref={subjectHref}
      />
    );
  }

  const runStart = run ?? now.toISOString();
  const spend = collectSpend();
  const result = await askCell(
    learn,
    userId,
    picked.cellId,
    process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY, onSpend: spend.sink } : undefined,
    undefined,
    roleLineFinder(learn, userId),
  );
  await recordLearnSpend(userId, 'write-cell-case', spend.reports);
  if (!result.ok) return <PracticeError message={result.error} retryHref={practiceHref({ ...scope, run: runStart })} />;

  return (
    <CellAnswer
      key={result.asked.questionId}
      asked={{
        ...result.asked,
        step: `Question ${asked + 1} of up to ${PLACEMENT_QUESTIONS}`,
        why: whyLine(picked, now),
      }}
      nextHref={practiceHref({ ...scope, run: runStart, after: result.asked.questionId })}
      endHref={practiceHref({ ...scope, end: runStart, skip: true })}
      endLabel="Skip to the lesson"
      endShort="Skip"
      holdForward
    />
  );
}
