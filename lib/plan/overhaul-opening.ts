import type { PlanAssignee, PlanKind, PlanSize, PlanStatus, PlanTrack } from './load';
import type { PlanScope } from './projects';

/**
 * The rows an approved spec change becomes when it replaces how something
 * works (plan #1527, docs/SPEC-LAYER-SPEC.md Part 4).
 *
 * Decision #1508 settled it as A: approving the change approves the overhaul,
 * with one stop. Nothing of the phases is built until the person has tried the
 * design on one workspace and accepted it. So the overhaul starts with three
 * rows and no more:
 *
 *  1. the design session, ready to build;
 *  2. the person's setup step to try the preview and accept it, which waits
 *     on the design;
 *  3. the step that writes the phases from the spec's Contract heading, which
 *     waits on both. It is not ready until the try-it step is closed, and no
 *     build step of the phases exists until it runs.
 *
 * `.claude/skills/plan/reference/overhaul.md` is how the overhaul's run works
 * those three; this file only writes them. Pure, so the shape and its
 * readiness can be tested without a database, and the same rows reach the
 * live plan through `overhaulOpeningSql`, whether a run uses the CLI or the
 * Supabase connector.
 */

export type OverhaulOpeningInput = {
  /** The overhaul's title, as any feature's. */
  title: string;
  /**
   * The feature's detail: the vision line, the sentence naming the spec
   * change, and what the change replaces. Written by the shaping run.
   */
  detail: string;
  /** The overhaul's own done-when. */
  acceptance: string | null;
  module: PlanScope | null;
  /** The spec the change was written into, such as `docs/CORE-AND-DASH-SPEC.md`. */
  spec: string;
  /**
   * The workspace the design session moves across first, in words ("job
   * roles"). Null leaves the choice to the design session, which takes the
   * spec's own or the smallest one the change touches.
   */
  workspace: string | null;
  /** The session stamp the build rows carry, from `sessionStamp`. */
  stamp: string;
  /**
   * Ids for the four rows, in the order feature, design, try-it, phases.
   * Passed in so the SQL can wire the dependencies without reading anything
   * back, and so a test can build the tree from the same ids.
   */
  ids: readonly [string, string, string, string];
};

export type OpeningKey = 'feature' | 'design' | 'tryIt' | 'phases';

export type OpeningRow = {
  key: OpeningKey;
  id: string;
  /** Null for the feature, which sits at the top of its module. */
  parentId: string | null;
  title: string;
  detail: string;
  acceptance: string | null;
  kind: PlanKind;
  status: PlanStatus;
  track: PlanTrack;
  assignee: PlanAssignee | null;
  size: PlanSize | null;
  /** Among its siblings. The feature's is worked out against its module. */
  position: number;
  comment: string | null;
};

export type OpeningDependency = { itemId: string; dependsOnId: string };

export type OverhaulOpening = {
  rows: OpeningRow[];
  dependencies: OpeningDependency[];
};

export function overhaulOpening(input: OverhaulOpeningInput): OverhaulOpening {
  const [featureId, designId, tryItId, phasesId] = input.ids;
  const where = input.workspace ?? 'one workspace';
  const which = input.workspace
    ? ''
    : ' The spec names the workspace to move first; when it does not, take the smallest one the change touches.';

  const rows: OpeningRow[] = [
    {
      key: 'feature',
      id: featureId,
      parentId: null,
      title: input.title,
      detail: input.detail,
      acceptance: input.acceptance,
      kind: 'build',
      status: 'not_started',
      track: 'overhaul',
      assignee: null,
      size: 'l',
      position: 0,
      comment: input.stamp,
    },
    {
      key: 'design',
      id: designId,
      parentId: featureId,
      title: `Build the new design with ${where} moved across`,
      detail:
        `On a branch, build the shared pieces ${input.spec} describes and move ${where} onto ` +
        `them completely, so its reads, writes and screens use nothing of the old way.${which} ` +
        'Schema changes only add tables and columns main does not read, applied to the live ' +
        'project in the same sitting. Write the flow test for the moved workspace in ' +
        `tests/flows/, and the Contract and Design log headings in ${input.spec}. Push the ` +
        'branch, link its preview in a comment on the try-it step below, and hand over to it ' +
        'as .claude/skills/plan/reference/overhaul.md says. The branch merges only after you ' +
        'accept it.',
      acceptance:
        `A pushed branch has ${where} running only on the new pieces, with its flow test ` +
        `passing and the Contract heading in ${input.spec} naming the files that define each ` +
        "piece. The preview's link is on the try-it step.",
      kind: 'build',
      status: 'not_started',
      track: 'feature',
      assignee: null,
      size: 'm',
      position: 10,
      comment: input.stamp,
    },
    {
      key: 'tryIt',
      id: tryItId,
      parentId: featureId,
      title: `Try the new design on ${where} and accept it`,
      detail:
        'Open the preview Dash links in a comment here once the design is pushed, and use ' +
        `${where} the way you normally would. Say "I have set this up" when it is right. If ` +
        'something is wrong, comment here with what, and Dash reworks the branch. Nothing else ' +
        'in this overhaul is built until you accept it.',
      acceptance: null,
      kind: 'setup',
      status: 'not_started',
      track: 'feature',
      assignee: 'me',
      size: null,
      position: 20,
      comment: null,
    },
    {
      key: 'phases',
      id: phasesId,
      parentId: featureId,
      title: 'Write the phases from the accepted design',
      detail:
        `Read the Contract and Design log in ${input.spec} on main, then write the three phases ` +
        'under this overhaul with their steps: build the new pieces alongside the old, move ' +
        'each workspace across, and remove the old way. Each phase ends with a flow test the ' +
        'next one waits on. Follow "Write the phases" in ' +
        '.claude/skills/plan/reference/overhaul.md.',
      acceptance:
        'The three phases are under this overhaul with their steps, every rule on the ' +
        "Contract's Rules line has a removal step whose done-when is its count reaching its " +
        'target, and each phase ends with a flow-test step the next phase waits on.',
      kind: 'build',
      status: 'not_started',
      track: 'feature',
      assignee: null,
      size: 's',
      position: 30,
      comment: input.stamp,
    },
  ];

  return {
    rows,
    dependencies: [
      // Nothing to try until the design is pushed. overhaul.md turns this
      // edge round when the design step hands over, so the two never wait on
      // each other at once.
      { itemId: tryItId, dependsOnId: designId },
      // The stop #1508 chose: the phases wait on your acceptance...
      { itemId: phasesId, dependsOnId: tryItId },
      // ...and on the design being merged, since they are read off main.
      { itemId: phasesId, dependsOnId: designId },
    ],
  };
}

/** A literal Postgres reads back exactly, whatever quotes the text holds. */
export function sqlText(value: string | null): string {
  if (value === null) return 'null';
  let tag = 'o';
  for (let n = 1; value.includes(`$${tag}$`); n += 1) tag = `o${n}`;
  return `$${tag}$${value}$${tag}$`;
}

/**
 * The statements that write the opening to the live plan, run in order: the
 * four rows, the three dependencies, the link from the spec change to the
 * overhaul, and a select returning the numbers given. Plain statements with
 * the ids written out rather than one statement of chained inserts, because
 * each insert takes its number from a counter the trigger updates, and
 * separate statements keep that the same path every other insert takes.
 */
export function overhaulOpeningSql(
  opening: OverhaulOpening,
  context: { userId: string; module: PlanScope | null; changeId: string | null },
): string[] {
  const user = sqlText(context.userId);
  const scope = sqlText(context.module);
  const statements = opening.rows.map((row) => {
    const position =
      row.parentId === null
        ? `(select coalesce(max(position), 0) + 10 from plan_items where user_id = ${user} ` +
          `and parent_id is null and module is not distinct from ${scope})`
        : String(row.position);
    return (
      'insert into plan_items (id, user_id, module, parent_id, title, detail, acceptance, kind, ' +
      'status, track, assignee, size, priority, position, comment) values (' +
      [
        sqlText(row.id),
        user,
        scope,
        row.parentId ? sqlText(row.parentId) : 'null',
        sqlText(row.title),
        sqlText(row.detail),
        sqlText(row.acceptance),
        sqlText(row.kind),
        sqlText(row.status),
        sqlText(row.track),
        sqlText(row.assignee),
        sqlText(row.size),
        '2',
        position,
        sqlText(row.comment),
      ].join(', ') +
      ');'
    );
  });
  for (const edge of opening.dependencies) {
    statements.push(
      'insert into plan_dependencies (user_id, item_id, depends_on_id) values (' +
        `${user}, ${sqlText(edge.itemId)}, ${sqlText(edge.dependsOnId)});`,
    );
  }
  const feature = opening.rows[0];
  if (context.changeId) {
    statements.push(
      `update spec_changes set plan_item_id = ${sqlText(feature.id)} ` +
        `where id = ${sqlText(context.changeId)} and user_id = ${user};`,
    );
  }
  statements.push(
    'select number, title, kind, status from plan_items where id in (' +
      opening.rows.map((row) => sqlText(row.id)).join(', ') +
      `) and user_id = ${user} order by number;`,
  );
  return statements;
}
