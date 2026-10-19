import { createHash } from 'node:crypto';
import type { ColumnType } from './types';

// The canonical form of a value, so a value a mapper intends and the same
// value read back from the database hash alike (plan #2432.2). Postgres hands
// a timestamptz back as "…+00:00" with microseconds, a numeric sometimes as a
// string, and jsonb with its keys reordered; each is brought to one spelling.

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sorted((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function canonicalValue(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'text':
      return String(value);
    case 'uuid':
      return String(value).toLowerCase();
    case 'timestamptz': {
      const ms = Date.parse(String(value));
      return Number.isNaN(ms) ? String(value) : new Date(ms).toISOString();
    }
    case 'date':
      return String(value).slice(0, 10);
    case 'number': {
      const n = Number(value);
      return Number.isNaN(n) ? String(value) : n;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 't';
    case 'jsonb':
      return sorted(typeof value === 'string' ? safeParse(value) : value);
    case 'text[]':
      return Array.isArray(value) ? value.map((v) => (v === null ? null : String(v))) : [String(value)];
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The columns' values in canonical form, in column order. */
export function canonicalRow(columns: Record<string, ColumnType>, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(columns).sort()) out[name] = canonicalValue(columns[name], values[name]);
  return out;
}

/** A hash of the columns' values, the one core.import_keys.values_hash keeps. */
export function valuesHash(columns: Record<string, ColumnType>, values: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalRow(columns, values))).digest('hex').slice(0, 32);
}

/** The columns whose canonical values differ between two rows. */
export function changedColumns(
  columns: Record<string, ColumnType>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const a = canonicalRow(columns, before);
  const b = canonicalRow(columns, after);
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
