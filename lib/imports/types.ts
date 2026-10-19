// The shapes the import engine works in (plan #2432.2).
//
// A mapper turns one kind of record from an export into the rows it should
// become in one table. The engine compares those intended rows with what
// earlier imports wrote (core.import_keys) and with the rows as they stand,
// and produces a plan: what it would add, update, leave unchanged, leave alone
// because the person edited it, and skip. Applying the plan writes the rows
// and their keys together (core.import_apply).

/**
 * How a column's value is compared. The engine hashes values in a canonical
 * form, so "2025-07-01T10:00:00Z" from a mapper and "2025-07-01T10:00:00+00:00"
 * read back from the database count as the same value.
 */
export type ColumnType = 'text' | 'uuid' | 'timestamptz' | 'date' | 'number' | 'boolean' | 'jsonb' | 'text[]';

/** A value that stands for the id of the row another record became. */
export interface RowRef {
  /**
   * `orNull` makes it null, rather than skipping the record, when that record
   * made no row (a connection's employer the person does not track, #2432.5).
   */
  $ref: { kind: string; key: string; orNull?: boolean };
}

/** The values a record should give its row: column name to value or ref. */
export type IntendedValues = Record<string, unknown>;

/** One record as a mapper hands it over: its key and the row it should be, or why it is skipped. */
export type MappedRecord =
  | {
      key: string;
      values: IntendedValues;
      skip?: undefined;
      /**
       * Set when the record may only join a row the person already has: with
       * no match it is skipped, for this reason, rather than added.
       */
      joinOnly?: string;
    }
  | { key: string; skip: string; values?: undefined; joinOnly?: undefined };

/** A record with no key yet, offered to a mapper's `match`. */
export interface PendingRecord {
  key: string;
  values: IntendedValues;
}

/** A pending record `match` found should not be imported, and why. */
export interface MatchSkip {
  skip: string;
}

export interface ImportMapper<Input> {
  /** The kind of record, unique within a source, such as 'applications'. */
  kind: string;
  /** The table its rows go in, as schema.table. It has `id uuid` and `user_id uuid`. */
  table: string;
  /**
   * Every column the mapper writes, with how its value is compared. Only these
   * columns are written, read back and hashed; the person's other columns on
   * the row are never touched.
   */
  columns: Record<string, ColumnType>;
  /** The records of this kind in the export. */
  records(input: Input): MappedRecord[];
  /**
   * Rows the person already has that a record with no key should join rather
   * than add, returned as record key to row id (an application already
   * tracked from mail, say). A joined row has only its empty columns filled
   * (null, or an empty array). A record mapped to `{ skip }` instead is
   * skipped for that reason: it is already in the app another way.
   */
  match?(pending: PendingRecord[], store: ImportStore): Promise<Map<string, string | MatchSkip>>;
  /**
   * Records with no key that are not imported because the person already
   * keeps them elsewhere, as record key to the reason (a LinkedIn course that
   * is already on one of their transcripts). They count as skipped.
   */
  exclude?(pending: PendingRecord[], store: ImportStore): Promise<Map<string, string>>;
}

export type Outcome = 'added' | 'updated' | 'unchanged' | 'kept' | 'skipped';

export type Counts = Record<Outcome, number>;

export interface PlannedRecord {
  key: string;
  outcome: Outcome;
  /** The row it is or will be; null when skipped. */
  rowId: string | null;
  /** Why it was kept or skipped. */
  reason?: string;
  /** For an update, the columns whose values change. */
  changed?: string[];
}

/** One row write and its key, as core.import_apply takes it. */
export interface ImportWrite {
  op: 'insert' | 'update';
  kind: string;
  key: string;
  table: string;
  row_id: string;
  values: Record<string, unknown>;
  hash: string;
}

export interface PlannedKind {
  kind: string;
  table: string;
  counts: Counts;
  records: PlannedRecord[];
}

export interface ImportPlan {
  source: string;
  kinds: PlannedKind[];
  /** In the order they must be applied: a kind's rows before the kinds that refer to them. */
  writes: ImportWrite[];
  totals: Counts;
}

/** What an earlier import recorded for one record. */
export interface ImportKey {
  kind: string;
  key: string;
  table: string;
  rowId: string;
  hash: string;
}

/** A file of the export the import left out or read only in part, and why. */
export interface SkippedFile {
  path: string;
  reason: string;
}

export interface RunMeta {
  archiveDate?: string | null;
  storagePath?: string | null;
  /** Kept on the run, so its history can say what was left out (plan #2432.9). */
  skippedFiles?: SkippedFile[];
}

/**
 * Where the engine reads and writes. Every call is scoped to one user: the
 * store is made for them, and nothing it reads or writes belongs to anyone
 * else (lib/imports/supabase-store.ts; lib/imports/memory-store.ts in tests).
 */
export interface ImportStore {
  /** Every key earlier imports from this source recorded. */
  loadKeys(source: string): Promise<ImportKey[]>;
  /** The rows with these ids, with these columns and `id`. Missing rows are absent. */
  readRows(table: string, ids: string[], columns: string[]): Promise<Record<string, unknown>[]>;
  /** Rows whose `column` is one of `values`, for a mapper's match. */
  rowsWhere(table: string, columns: string[], column: string, values: unknown[]): Promise<Record<string, unknown>[]>;
  createRun(source: string, meta: RunMeta): Promise<string>;
  /** Writes a batch of rows and their keys in one transaction; returns the keys written. */
  applyBatch(runId: string, writes: ImportWrite[]): Promise<number>;
  finishRun(runId: string, result: { status: 'applied' | 'failed'; counts: Record<string, Counts>; error?: string }): Promise<void>;
}
