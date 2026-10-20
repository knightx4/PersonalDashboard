import { randomUUID } from 'node:crypto';
import { canonicalRow, changedColumns, valuesHash } from './canonical';
import type {
  Counts,
  ImportKey,
  ImportMapper,
  ImportPlan,
  ImportStore,
  ImportWrite,
  IntendedValues,
  MappedRecord,
  MatchSkip,
  PlannedKind,
  PlannedRecord,
  RowRef,
  RunMeta,
} from './types';

// The import engine (plan #2432.2). planImport reads what earlier imports
// wrote and the rows as they stand, and says what an import would do;
// applyPlan does it. A dry run is planImport alone, and writes nothing.
//
// For each record, by its key in core.import_keys:
//
//   no key, no match      added: a new row, with an id chosen here.
//   no key, excluded      skipped: the person keeps it elsewhere already.
//   no key, a match       joined: the person's row gains the key, and only its
//                         empty columns are filled (updated, or unchanged when
//                         none were empty).
//   no key, joinOnly      skipped: the record may only join, and found no row.
//   no key, match skip    skipped: match found it in the app another way.
//   key, row gone         kept: the person deleted it, so it stays deleted.
//   key, row differs      kept: the row no longer matches the hash of what the
//   from the hash         import last wrote, so the person edited it.
//   key, same values      unchanged.
//   key, new values       updated: the row is as the import left it, and the
//                         export now says something else.
//
// A mapper later in the list may refer to an earlier one's rows with ref().

const BATCH = 200;

export function emptyCounts(): Counts {
  return { added: 0, updated: 0, unchanged: 0, kept: 0, skipped: 0 };
}

/**
 * A value standing for the id of the row the record `key` of `kind` became.
 * With `orNull`, a record that made no row gives null instead of a skip.
 */
export function ref(kind: string, key: string, options: { orNull?: boolean } = {}): RowRef {
  return options.orNull ? { $ref: { kind, key, orNull: true } } : { $ref: { kind, key } };
}

function isRef(value: unknown): value is RowRef {
  return !!value && typeof value === 'object' && '$ref' in value;
}

type Resolved = Map<string, Map<string, string>>;

function resolvedFor(resolved: Resolved, kind: string): Map<string, string> {
  let byKey = resolved.get(kind);
  if (!byKey) {
    byKey = new Map();
    resolved.set(kind, byKey);
  }
  return byKey;
}

/** The values with every ref replaced by its row id, or the ref that has none. */
function resolveRefs(values: IntendedValues, resolved: Resolved): { values: IntendedValues } | { missing: RowRef } {
  const out: IntendedValues = {};
  for (const [column, value] of Object.entries(values)) {
    if (isRef(value)) {
      const id = resolved.get(value.$ref.kind)?.get(value.$ref.key);
      if (!id && !value.$ref.orNull) return { missing: value };
      out[column] = id ?? null;
    } else {
      out[column] = value;
    }
  }
  return { values: out };
}

/** Null, or an array with nothing in it: a column a join may fill. */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function pick(columns: string[], values: IntendedValues): IntendedValues {
  const out: IntendedValues = {};
  for (const c of columns) out[c] = values[c] ?? null;
  return out;
}

export async function planImport<Input>(
  store: ImportStore,
  source: string,
  mappers: ImportMapper<Input>[],
  input: Input,
): Promise<ImportPlan> {
  const keys = await store.loadKeys(source);
  const byKind = new Map<string, Map<string, ImportKey>>();
  const resolved: Resolved = new Map();
  for (const k of keys) {
    if (!byKind.has(k.kind)) byKind.set(k.kind, new Map());
    byKind.get(k.kind)!.set(k.key, k);
    resolvedFor(resolved, k.kind).set(k.key, k.rowId);
  }

  const kinds: PlannedKind[] = [];
  const writes: ImportWrite[] = [];
  const totals = emptyCounts();

  for (const mapper of mappers) {
    const columnNames = Object.keys(mapper.columns);
    const counts = emptyCounts();
    const records: PlannedRecord[] = [];
    const known = byKind.get(mapper.kind) ?? new Map<string, ImportKey>();
    const ids = resolvedFor(resolved, mapper.kind);
    const note = (r: PlannedRecord) => {
      records.push(r);
      counts[r.outcome] += 1;
    };

    // The records, once each, with their refs resolved.
    const seen = new Set<string>();
    const ready: { key: string; values: IntendedValues }[] = [];
    const joinOnly = new Map<string, string>();
    const onInsert = new Map<string, IntendedValues>();
    for (const record of mapper.records(input) as MappedRecord[]) {
      if (seen.has(record.key)) {
        note({ key: record.key, outcome: 'skipped', rowId: null, reason: 'The export has this record twice.' });
        continue;
      }
      seen.add(record.key);
      if (record.skip !== undefined) {
        note({ key: record.key, outcome: 'skipped', rowId: null, reason: record.skip });
        continue;
      }
      const r = resolveRefs(record.values, resolved);
      if ('missing' in r) {
        note({
          key: record.key,
          outcome: 'skipped',
          rowId: null,
          reason: `It belongs to ${r.missing.$ref.kind} ${r.missing.$ref.key}, which was not imported.`,
        });
        continue;
      }
      ready.push({ key: record.key, values: pick(columnNames, r.values) });
      if (record.joinOnly) joinOnly.set(record.key, record.joinOnly);
      if (record.onInsert) onInsert.set(record.key, record.onInsert);
    }

    // Records with no key may join a row the person already has, or be found
    // to be in the app another way.
    const unkeyed = ready.filter((r) => !known.has(r.key));
    const excluded = mapper.exclude && unkeyed.length > 0 ? await mapper.exclude(unkeyed, store) : new Map<string, string>();
    const pending = unkeyed.filter((r) => !excluded.has(r.key));
    const found = mapper.match && pending.length > 0 ? await mapper.match(pending, store) : new Map<string, string | MatchSkip>();
    const matched = new Map<string, string>();
    const skipped = new Map<string, string>(excluded);
    for (const [key, hit] of found) {
      if (typeof hit === 'string') matched.set(key, hit);
      else skipped.set(key, hit.skip);
    }

    // The rows as they stand, for keyed and matched records alike.
    const liveIds = [
      ...ready.flatMap((r) => (known.get(r.key)?.table === mapper.table ? [known.get(r.key)!.rowId] : [])),
      ...matched.values(),
    ];
    const live = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < liveIds.length; i += BATCH) {
      for (const row of await store.readRows(mapper.table, liveIds.slice(i, i + BATCH), columnNames)) {
        live.set(String(row.id), row);
      }
    }

    for (const { key, values } of ready) {
      const hash = valuesHash(mapper.columns, values);
      const prior = known.get(key);

      if (!prior) {
        const skip = skipped.get(key);
        if (skip !== undefined) {
          note({ key, outcome: 'skipped', rowId: null, reason: skip });
          continue;
        }
        const joinId = matched.get(key);
        const joined = joinId ? live.get(joinId) : undefined;
        if (joinId && joined) {
          const now = canonicalRow(mapper.columns, joined);
          const fills = columnNames.filter((c) => isEmpty(now[c]) && !isEmpty(values[c]));
          writes.push({ op: 'update', kind: mapper.kind, key, table: mapper.table, row_id: joinId, values: pick(fills, values), hash });
          ids.set(key, joinId);
          note({ key, outcome: fills.length ? 'updated' : 'unchanged', rowId: joinId, changed: fills.length ? fills : undefined });
          continue;
        }
        const only = joinOnly.get(key);
        if (only !== undefined) {
          note({ key, outcome: 'skipped', rowId: null, reason: only });
          continue;
        }
        const id = randomUUID();
        writes.push({ op: 'insert', kind: mapper.kind, key, table: mapper.table, row_id: id, values: { ...onInsert.get(key), ...values }, hash });
        ids.set(key, id);
        note({ key, outcome: 'added', rowId: id });
        continue;
      }

      const row = prior.table === mapper.table ? live.get(prior.rowId) : undefined;
      if (!row) {
        ids.delete(key);
        note({ key, outcome: 'kept', rowId: null, reason: 'You removed it after an earlier import.' });
        continue;
      }
      if (valuesHash(mapper.columns, row) !== prior.hash) {
        note({ key, outcome: 'kept', rowId: prior.rowId, reason: 'You changed it after an earlier import.' });
        continue;
      }
      if (hash === prior.hash) {
        note({ key, outcome: 'unchanged', rowId: prior.rowId });
        continue;
      }
      const changed = changedColumns(mapper.columns, row, values);
      writes.push({ op: 'update', kind: mapper.kind, key, table: mapper.table, row_id: prior.rowId, values, hash });
      note({ key, outcome: 'updated', rowId: prior.rowId, changed });
    }

    kinds.push({ kind: mapper.kind, table: mapper.table, counts, records });
    for (const o of Object.keys(totals) as (keyof Counts)[]) totals[o] += counts[o];
  }

  return { source, kinds, writes, totals };
}

/** Writes a plan: one run row, then the rows and their keys in batches, in order. Returns the run id. */
export async function applyPlan(store: ImportStore, plan: ImportPlan, meta: RunMeta = {}): Promise<string> {
  const runId = await store.createRun(plan.source, meta);
  const counts = Object.fromEntries(plan.kinds.map((k) => [k.kind, k.counts]));
  try {
    for (let i = 0; i < plan.writes.length; i += BATCH) {
      await store.applyBatch(runId, plan.writes.slice(i, i + BATCH));
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await store.finishRun(runId, { status: 'failed', counts, error });
    throw err;
  }
  await store.finishRun(runId, { status: 'applied', counts });
  return runId;
}

/** One line per kind, for a script or a log: "connections: 12 added, 3 unchanged". */
export function describePlan(plan: ImportPlan): string[] {
  const parts = (c: Counts) =>
    (Object.keys(c) as (keyof Counts)[])
      .filter((o) => c[o] > 0)
      .map((o) => `${c[o]} ${o}`)
      .join(', ') || 'nothing';
  return [...plan.kinds.map((k) => `${k.kind}: ${parts(k.counts)}`), `total: ${parts(plan.totals)}`];
}
