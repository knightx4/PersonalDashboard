import { describe, expect, it } from 'vitest';
import type { PlanDependency, PlanItem } from '@/lib/plan/load';
import {
  overhaulOpening,
  overhaulOpeningSql,
  sqlText,
  type OverhaulOpening,
} from '@/lib/plan/overhaul-opening';
import { buildPlanTree, findNode, workOrder } from '@/lib/plan/tree';

const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
] as const;

/** A test spec change marked as a replacement, shaped. */
function shaped(): OverhaulOpening {
  return overhaulOpening({
    title: 'Run every thread through one shared table',
    detail:
      'From the spec change "One thread table", approved on 2026-10-03. Replaces the five thread tables.',
    acceptance: 'Every thread is one row in the shared table.',
    module: 'dev',
    spec: 'docs/TEST-SPEC.md',
    workspace: 'job roles',
    stamp: 'Added by session cse_test on 2026-10-03.',
    ids: IDS,
  });
}

/** The opening as the plan page and `next --claude` would read it. */
function asPlan(
  opening: OverhaulOpening,
  status: Partial<Record<string, PlanItem['status']>> = {},
) {
  const items: PlanItem[] = opening.rows.map((row, index) => ({
    id: row.id,
    number: 900 + index,
    module: 'dev',
    parentId: row.parentId,
    title: row.title,
    detail: row.detail,
    acceptance: row.acceptance,
    status: status[row.key] ?? row.status,
    kind: row.kind,
    track: row.track,
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: row.comment,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: row.size,
    assignee: row.assignee,
    commitSha: null,
    position: row.position,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-03T00:00:00Z',
    updatedAt: '2026-10-03T00:00:00Z',
  }));
  const dependencies: PlanDependency[] = opening.dependencies.map((edge) => ({
    id: `${edge.itemId}->${edge.dependsOnId}`,
    ...edge,
  }));
  return buildPlanTree({ items, dependencies });
}

function readyTitles(sections: ReturnType<typeof asPlan>): string[] {
  return workOrder(sections, { only: 'runner' }).map((node) => node.title);
}

describe('overhaulOpening', () => {
  it('writes an approved overhaul with exactly the design, try-it and write-the-phases steps', () => {
    const opening = shaped();
    const [feature, ...steps] = opening.rows;
    expect(feature).toMatchObject({ track: 'overhaul', status: 'not_started', parentId: null });
    expect(steps.map((row) => [row.key, row.kind, row.status, row.parentId])).toEqual([
      ['design', 'build', 'not_started', IDS[0]],
      ['tryIt', 'setup', 'not_started', IDS[0]],
      ['phases', 'build', 'not_started', IDS[0]],
    ]);
    expect(steps[1].assignee).toBe('me');
    // The build rows say a session wrote them; the person's setup step does not.
    expect(steps.map((row) => row.comment !== null)).toEqual([true, false, true]);
  });

  it('lists only the design step as ready at first', () => {
    expect(readyTitles(asPlan(shaped()))).toEqual([
      'Build the new design with job roles moved across',
    ]);
  });

  it('does not list the write-the-phases step as ready until the try-it step is closed', () => {
    const opening = shaped();
    const phases = 'Write the phases from the accepted design';

    // The design pushed and merged, but you have not accepted it.
    const waiting = asPlan(opening, { design: 'done' });
    expect(readyTitles(waiting)).not.toContain(phases);
    expect(findNode(waiting, IDS[3])?.ready).toBe(false);

    const accepted = asPlan(opening, { design: 'done', tryIt: 'done' });
    expect(readyTitles(accepted)).toEqual([phases]);
  });

  it('leaves the choice of workspace to the design session when none is named', () => {
    const opening = overhaulOpening({ ...shapedInput(), workspace: null });
    expect(opening.rows[1].title).toBe('Build the new design with one workspace moved across');
    expect(opening.rows[1].detail).toContain('take the smallest one the change touches');
  });
});

function shapedInput() {
  return {
    title: 'T',
    detail: 'D',
    acceptance: null,
    module: 'dev' as const,
    spec: 'docs/TEST-SPEC.md',
    workspace: 'job roles',
    stamp: 'Added by a session on 2026-10-03.',
    ids: IDS,
  };
}

describe('overhaulOpeningSql', () => {
  it('writes the rows, the edges, the link to the change and reads the numbers back', () => {
    const statements = overhaulOpeningSql(shaped(), {
      userId: 'u-1',
      module: 'dev',
      changeId: 'c-1',
    });
    expect(statements).toHaveLength(4 + 3 + 1 + 1);
    expect(statements[0]).toContain('$o$overhaul$o$');
    expect(statements[0]).toContain('coalesce(max(position), 0) + 10');
    expect(statements[7]).toBe(
      `update spec_changes set plan_item_id = $o$${IDS[0]}$o$ where id = $o$c-1$o$ and user_id = $o$u-1$o$;`,
    );
    expect(statements[8]).toMatch(/^select number/);
  });

  it('leaves the link out when no change is named', () => {
    const statements = overhaulOpeningSql(shaped(), {
      userId: 'u-1',
      module: null,
      changeId: null,
    });
    expect(statements.some((s) => s.startsWith('update spec_changes'))).toBe(false);
  });
});

describe('sqlText', () => {
  it('picks a tag the text does not contain', () => {
    expect(sqlText("it's")).toBe("$o$it's$o$");
    expect(sqlText('a $o$ b')).toBe('$o1$a $o$ b$o1$');
    expect(sqlText(null)).toBe('null');
  });
});
