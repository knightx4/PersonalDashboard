import { describe, expect, it } from 'vitest';
import {
  changeLines,
  emptyNames,
  fieldsAfterUndo,
  findUndoable,
  namesNeeded,
  undoTargetFor,
  type ChangeNames,
  type HistoryRow,
  type UndoTarget,
} from '@/lib/goals/run-changes';

const RUN = 'run-1';
let nextId = 1;

function row(overrides: Partial<HistoryRow>): HistoryRow {
  return {
    id: nextId++,
    table_name: 'items',
    row_id: 'step-1',
    action: 'insert',
    old_values: null,
    new_values: null,
    actor: 'claude',
    created_at: '2026-09-25T06:00:00Z',
    undoes: null,
    undoes_field: null,
    ...overrides,
  };
}

function names(): ChangeNames {
  const n = emptyNames();
  n.items.set('step-1', { title: 'Turn on autopay', level: 'step', kind: 'mine' });
  n.items.set('step-2', { title: 'Check loan drafts', level: 'step', kind: 'claude' });
  n.items.set('goal-1', { title: 'Pay off the loans', level: 'goal', kind: null });
  n.collections.set('loans-id', 'loans');
  return n;
}

const LOAN_FIELDS = [
  { key: 'name', type: 'text', label: 'Loan' },
  { key: 'balance', type: 'money', label: 'Balance', tracked: true },
];

function addedStep(id = 'step-1'): HistoryRow {
  return row({
    row_id: id,
    new_values: {
      id,
      level: 'step',
      kind: 'mine',
      title: 'Turn on autopay',
      status: 'open',
      parent_id: 'goal-1',
    },
  });
}

function addedField(): HistoryRow {
  return row({
    table_name: 'collections',
    row_id: 'loans-id',
    action: 'update',
    old_values: { fields: LOAN_FIELDS, version: 1 },
    new_values: {
      fields: [...LOAN_FIELDS, { key: 'originated_on', type: 'date', label: 'Loan originated' }],
      version: 2,
    },
  });
}

function filedRecord(id: string, draft = true): HistoryRow {
  return row({
    table_name: 'records',
    row_id: id,
    new_values: { id, collection_id: 'loans-id', data: { name: `Loan ${id}` }, draft },
  });
}

describe('changeLines sentences', () => {
  it('says what a run did in sentences, filing into one collection as one line', () => {
    const lines = changeLines(
      [
        addedStep(),
        filedRecord('r1'),
        filedRecord('r2'),
        filedRecord('r3'),
        filedRecord('r4'),
        row({
          row_id: 'step-2',
          action: 'update',
          old_values: { status: 'open' },
          new_values: { status: 'done' },
        }),
      ],
      [],
      names(),
    );
    expect(lines.map((l) => l.sentence)).toEqual([
      'Added step Turn on autopay',
      'Filed 4 loans',
      'Closed Check loan drafts',
    ]);
  });

  it('gives each field a change added to a collection a line of its own', () => {
    const lines = changeLines([addedField()], [], names());
    expect(lines.map((l) => l.sentence)).toEqual(['Added field Loan originated to loans']);
  });

  it('leaves out the run row and readings a record wrote', () => {
    const lines = changeLines(
      [
        row({
          table_name: 'runs',
          row_id: RUN,
          action: 'update',
          old_values: { status: 'started' },
          new_values: { status: 'done' },
        }),
        row({ table_name: 'readings', row_id: 'rd', new_values: { record_id: 'r1', value: 400 } }),
        row({
          table_name: 'readings',
          row_id: 'rd2',
          new_values: { item_id: 'goal-1', value: 12000 },
        }),
      ],
      [],
      names(),
    );
    expect(lines.map((l) => l.sentence)).toEqual(['Logged 12000 on Pay off the loans']);
  });

  it('names a question, a move and a rename', () => {
    const lines = changeLines(
      [
        row({
          row_id: 'q',
          new_values: { level: 'step', kind: 'decision', title: 'Avalanche or snowball?' },
        }),
        row({
          row_id: 'step-1',
          action: 'update',
          old_values: { parent_id: 'a' },
          new_values: { parent_id: 'b' },
        }),
        row({
          row_id: 'step-2',
          action: 'update',
          old_values: { title: 'Check drafts' },
          new_values: { title: 'Check loan drafts' },
        }),
        row({
          row_id: 'step-2',
          action: 'update',
          old_values: { detail: null, acceptance: null },
          new_values: { detail: 'x', acceptance: 'y' },
        }),
      ],
      [],
      names(),
    );
    expect(lines.map((l) => l.sentence)).toEqual([
      'Asked Avalanche or snowball?',
      'Moved Turn on autopay',
      'Renamed Check drafts to Check loan drafts',
      'Changed the detail and done when on Check loan drafts',
    ]);
  });
});

describe('undo on a step Claude added', () => {
  it('archives the step', () => {
    const [line] = changeLines([addedStep()], [], names());
    expect(line.state).toBe('undoable');
    expect(line.targets).toEqual([
      expect.objectContaining({ kind: 'archive', table: 'items', rowId: 'step-1' }),
    ]);
  });

  it('reads as undone once an undo names it, and cannot be undone twice', () => {
    const added = addedStep();
    const undo = row({
      row_id: 'step-1',
      action: 'archive',
      actor: 'me',
      old_values: { archived_at: null },
      new_values: { archived_at: '2026-09-25T07:00:00Z' },
      undoes: added.id,
    });
    const lines = changeLines([added], [undo], names());
    expect(lines[0].state).toBe('undone');
    expect(findUndoable(lines, lines[0].key)).toBeNull();
  });

  it('is still offered after you edit the step, since archiving keeps your edit', () => {
    const added = addedStep();
    const edit = row({
      row_id: 'step-1',
      action: 'update',
      actor: 'me',
      old_values: { title: 'a' },
      new_values: { title: 'b' },
    });
    expect(changeLines([added], [edit], names())[0].state).toBe('undoable');
  });

  it('has nothing to undo once the step was archived another way', () => {
    const added = addedStep();
    const archived = row({
      row_id: 'step-1',
      action: 'archive',
      actor: 'me',
      old_values: { archived_at: null },
      new_values: { archived_at: 'x' },
    });
    const [line] = changeLines([added], [archived], names());
    expect(line.state).toBe('gone');
  });

  it('offers no Undo on a change you made yourself', () => {
    const [line] = changeLines([row({ ...addedStep(), actor: 'me' })], [], names());
    expect(line.state).toBe('none');
  });
});

describe('undo on a field Claude added to a collection', () => {
  it('hides the field and keeps every other field as it is now', () => {
    const [line] = changeLines([addedField()], [], names());
    expect(line.state).toBe('undoable');
    expect(line.key).toMatch(/:originated_on$/);
    const target = line.targets[0] as Extract<UndoTarget, { kind: 'field' }>;
    expect(target).toMatchObject({ kind: 'field', key: 'originated_on', before: null });

    const now = [
      ...LOAN_FIELDS,
      { key: 'originated_on', type: 'date', label: 'Loan originated' },
      { key: 'servicer', type: 'text', label: 'Servicer' },
    ];
    expect(fieldsAfterUndo(now, target)).toEqual([
      ...LOAN_FIELDS,
      { key: 'originated_on', type: 'date', label: 'Loan originated', removed: true },
      { key: 'servicer', type: 'text', label: 'Servicer' },
    ]);
  });

  it('puts a relabelled field back as it was', () => {
    const change = row({
      table_name: 'collections',
      row_id: 'loans-id',
      action: 'update',
      old_values: { fields: LOAN_FIELDS },
      new_values: { fields: [{ key: 'name', type: 'text', label: 'Loan name' }, LOAN_FIELDS[1]] },
    });
    const [line] = changeLines([change], [], names());
    expect(line.sentence).toBe('Renamed field Loan to Loan name in loans');
    const target = line.targets[0] as Extract<UndoTarget, { kind: 'field' }>;
    expect(fieldsAfterUndo(change.new_values?.fields, target)[0]).toEqual(LOAN_FIELDS[0]);
  });

  it('keeps a field that has changed again since', () => {
    const added = addedField();
    const relabel = row({
      table_name: 'collections',
      row_id: 'loans-id',
      action: 'update',
      actor: 'me',
      old_values: { fields: [] },
      new_values: {
        fields: [...LOAN_FIELDS, { key: 'originated_on', type: 'date', label: 'Originated' }],
      },
    });
    const [line] = changeLines([added], [relabel], names());
    expect(line.state).toBe('kept');
  });

  it('lets a second field be undone after the first was', () => {
    const change = row({
      table_name: 'collections',
      row_id: 'loans-id',
      action: 'update',
      old_values: { fields: LOAN_FIELDS },
      new_values: {
        fields: [
          ...LOAN_FIELDS,
          { key: 'a', type: 'date', label: 'A' },
          { key: 'b', type: 'date', label: 'B' },
        ],
      },
    });
    const undoA = row({
      table_name: 'collections',
      row_id: 'loans-id',
      action: 'update',
      actor: 'me',
      old_values: { fields: [] },
      new_values: {
        fields: [
          ...LOAN_FIELDS,
          { key: 'a', type: 'date', label: 'A', removed: true },
          { key: 'b', type: 'date', label: 'B' },
        ],
      },
      undoes: change.id,
      undoes_field: 'a',
    });
    const lines = changeLines([change], [undoA], names());
    expect(lines.map((l) => [l.sentence, l.state])).toEqual([
      ['Added field A to loans', 'undone'],
      ['Added field B to loans', 'undoable'],
    ]);
  });
});

describe('undo on records Claude filed', () => {
  it('keeps a record you have since confirmed and undoes the rest', () => {
    const r1 = filedRecord('r1');
    const r2 = filedRecord('r2');
    const confirmed = row({
      table_name: 'records',
      row_id: 'r1',
      action: 'update',
      actor: 'me',
      old_values: { draft: true },
      new_values: { draft: false },
    });
    const [line] = changeLines([r1, r2], [confirmed], names());
    expect(line.sentence).toBe('Filed 2 loans');
    expect(line.state).toBe('undoable');
    expect(line.targets.map((t) => t.rowId)).toEqual(['r1', 'r2']);
  });

  it('is kept whole when you have confirmed every one', () => {
    const r1 = filedRecord('r1');
    const edited = row({
      table_name: 'records',
      row_id: 'r1',
      action: 'update',
      actor: 'me',
      old_values: { data: {} },
      new_values: { data: { name: 'x' } },
    });
    const [line] = changeLines([r1], [edited], names());
    expect(line).toMatchObject({ state: 'kept', reason: 'You have confirmed or edited it since.' });
  });
});

describe('undo on a change to a row', () => {
  it('puts back the old values, leaving what the database keeps', () => {
    const closed = row({
      row_id: 'step-2',
      action: 'update',
      old_values: { status: 'open', closed_at: null },
      new_values: { status: 'done', closed_at: 'x' },
    });
    expect(undoTargetFor(closed)).toEqual({
      kind: 'revert',
      table: 'items',
      rowId: 'step-2',
      historyId: closed.id,
      values: { status: 'open' },
    });
  });

  it('is kept when the same column has changed again since', () => {
    const closed = row({
      row_id: 'step-2',
      action: 'update',
      old_values: { status: 'open' },
      new_values: { status: 'done' },
    });
    const reopened = row({
      row_id: 'step-2',
      action: 'update',
      actor: 'me',
      old_values: { status: 'done' },
      new_values: { status: 'open' },
    });
    expect(changeLines([closed], [reopened], names())[0].state).toBe('kept');
  });

  it('offers no Undo on a reply in a thread', () => {
    const reply = row({
      table_name: 'comments',
      row_id: 'c',
      new_values: { item_id: 'goal-1', author: 'claude', body: 'hi' },
    });
    const [line] = changeLines([reply], [], names());
    expect(line).toMatchObject({ sentence: 'Replied on Pay off the loans', state: 'none' });
  });
});

describe('namesNeeded', () => {
  it('collects the items, collections and records the sentences name', () => {
    expect(
      namesNeeded([
        addedStep(),
        filedRecord('r1'),
        row({
          table_name: 'dependencies',
          row_id: 'd',
          new_values: { item_id: 'a', depends_on_id: 'b' },
        }),
      ]),
    ).toEqual({ items: ['step-1', 'a', 'b'], collections: ['loans-id'], records: ['r1'] });
  });
});
