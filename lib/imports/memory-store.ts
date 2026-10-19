import { randomUUID } from 'node:crypto';
import type { Counts, ImportKey, ImportStore, ImportWrite, RunMeta } from './types';

// An ImportStore held in memory, for tests of the engine and of each mapper
// (plan #2432.2). applyBatch does what core.import_apply does: an insert makes
// the row with its id, an update sets only the columns given on a row that is
// still there, and each row written records its key.

export interface MemoryRun {
  id: string;
  source: string;
  meta: RunMeta;
  status: 'running' | 'applied' | 'failed';
  counts: Record<string, Counts>;
  error?: string;
}

export interface MemoryStore extends ImportStore {
  /** table to id to row. */
  tables: Map<string, Map<string, Record<string, unknown>>>;
  keys: Map<string, ImportKey & { source: string; runId: string }>;
  runs: MemoryRun[];
  /** The rows of a table, in insertion order. */
  rows(table: string): Record<string, unknown>[];
  /** Changes a row the way the person would in the app. */
  edit(table: string, id: string, values: Record<string, unknown>): void;
  remove(table: string, id: string): void;
}

export function memoryStore(seed: Record<string, Record<string, unknown>[]> = {}): MemoryStore {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  for (const [name, rows] of Object.entries(seed)) {
    for (const row of rows) table(name).set(String(row.id), { ...row });
  }
  const keys: MemoryStore['keys'] = new Map();
  const runs: MemoryRun[] = [];
  const project = (row: Record<string, unknown>, columns: string[]) => {
    const out: Record<string, unknown> = { id: row.id };
    for (const c of columns) out[c] = row[c] ?? null;
    return out;
  };

  return {
    tables,
    keys,
    runs,
    rows: (name) => [...table(name).values()],
    edit(name, id, values) {
      const row = table(name).get(id);
      if (!row) throw new Error(`no row ${id} in ${name}`);
      Object.assign(row, values);
    },
    remove(name, id) {
      table(name).delete(id);
    },

    async loadKeys(source) {
      return [...keys.values()].filter((k) => k.source === source).map(({ kind, key, table, rowId, hash }) => ({ kind, key, table, rowId, hash }));
    },
    async readRows(name, ids, columns) {
      return ids.flatMap((id) => {
        const row = table(name).get(id);
        return row ? [project(row, columns)] : [];
      });
    },
    async rowsWhere(name, columns, column, values) {
      return [...table(name).values()].filter((row) => values.includes(row[column])).map((row) => project(row, columns));
    },
    async createRun(source, meta) {
      const id = randomUUID();
      runs.push({ id, source, meta, status: 'running', counts: {} });
      return id;
    },
    async applyBatch(runId, writes: ImportWrite[]) {
      const run = runs.find((r) => r.id === runId && r.status === 'running');
      if (!run) throw new Error(`import run ${runId} is not running`);
      // All or nothing, as one transaction would be.
      const staged = new Map<string, Map<string, Record<string, unknown>>>();
      const current = (name: string) => {
        if (!staged.has(name)) staged.set(name, new Map([...table(name)].map(([id, row]) => [id, { ...row }])));
        return staged.get(name)!;
      };
      const stagedKeys = new Map(keys);
      let written = 0;
      for (const w of writes) {
        const rows = current(w.table);
        if (w.op === 'insert') {
          if (rows.has(w.row_id)) throw new Error(`duplicate key value: ${w.row_id}`);
          rows.set(w.row_id, { id: w.row_id, ...w.values });
        } else {
          const row = rows.get(w.row_id);
          if (!row) continue;
          Object.assign(row, w.values);
        }
        stagedKeys.set(`${run.source}\u0000${w.kind}\u0000${w.key}`, {
          source: run.source,
          kind: w.kind,
          key: w.key,
          table: w.table,
          rowId: w.row_id,
          hash: w.hash,
          runId,
        });
        written += 1;
      }
      for (const [name, rows] of staged) tables.set(name, rows);
      keys.clear();
      for (const [k, v] of stagedKeys) keys.set(k, v);
      return written;
    },
    async finishRun(runId, result) {
      const run = runs.find((r) => r.id === runId);
      if (!run) throw new Error(`no import run ${runId}`);
      run.status = result.status;
      run.counts = result.counts;
      run.error = result.error;
    },
  };
}
