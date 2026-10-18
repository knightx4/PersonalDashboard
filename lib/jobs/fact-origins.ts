import type { AppSupabaseClient } from './db/schema-name';

/**
 * Where each fact about a role came from (job_search.fact_origins,
 * migrations-job-search/0063). One row per role and field, or per company and
 * field; the value stays on roles or companies and this says who wrote it and
 * how sure that source could be. A writer replaces the row when it replaces
 * the value, so the row always describes the value on the page.
 */

/** The role's own fields that carry an origin. */
export const ROLE_FACT_FIELDS = ['comp', 'location', 'work_mode', 'seniority', 'posting_status'] as const;
/** The company's fields that carry an origin, shown on its roles too. */
export const COMPANY_FACT_FIELDS = ['stage'] as const;

export type RoleFactField = (typeof ROLE_FACT_FIELDS)[number];
export type CompanyFactField = (typeof COMPANY_FACT_FIELDS)[number];
export type FactField = RoleFactField | CompanyFactField;

/**
 * posting: the posting reader. recruiter_email: the mail import. dash: Dash
 * read or worked it out. you: typed by the person. unknown: saved before
 * origins were kept.
 */
export const FACT_ORIGINS = ['posting', 'recruiter_email', 'dash', 'you', 'unknown'] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

export const FACT_CERTAINTIES = ['firsthand', 'secondhand', 'guess'] as const;
export type FactCertainty = (typeof FACT_CERTAINTIES)[number];

export type FactOriginRecord = {
  field: FactField;
  origin: FactOrigin;
  /** Null exactly when origin is unknown. */
  certainty: FactCertainty | null;
  /** core.ingested_messages id of the mail it came from. */
  messageId: string | null;
  sourceUrl: string | null;
  recordedAt: string;
};

/** Every field of a role, each with its origin or null when none is recorded. */
export type RoleFactOrigins = Record<FactField, FactOriginRecord | null>;

export const FACT_ORIGIN_COLUMNS = 'role_id, company_id, field, origin, certainty, message_id, source_url, recorded_at';

type Row = {
  role_id?: string | null;
  company_id?: string | null;
  field?: unknown;
  origin?: unknown;
  certainty?: unknown;
  message_id?: unknown;
  source_url?: unknown;
  recorded_at?: unknown;
};

const ALL_FIELDS: readonly FactField[] = [...ROLE_FACT_FIELDS, ...COMPANY_FACT_FIELDS];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** One row as a record, or null when it names a field or origin this code does not know. */
export function toFactOrigin(row: Row): FactOriginRecord | null {
  if (!isOneOf(ALL_FIELDS, row.field) || !isOneOf(FACT_ORIGINS, row.origin)) return null;
  const certainty = row.origin === 'unknown' ? null : isOneOf(FACT_CERTAINTIES, row.certainty) ? row.certainty : null;
  return {
    field: row.field,
    origin: row.origin,
    certainty,
    messageId: textOrNull(row.message_id),
    sourceUrl: textOrNull(row.source_url),
    recordedAt: typeof row.recorded_at === 'string' ? row.recorded_at : '',
  };
}

/**
 * The rows for one role and its company as a record with every field present.
 * Role rows supply the role fields and company rows the company fields, so a
 * stray row on the wrong side is ignored.
 */
export function roleFactOrigins(rows: readonly Row[]): RoleFactOrigins {
  const out = Object.fromEntries(ALL_FIELDS.map((field) => [field, null])) as RoleFactOrigins;
  for (const row of rows) {
    const record = toFactOrigin(row);
    if (!record) continue;
    const onRole = Boolean(row.role_id) && isOneOf(ROLE_FACT_FIELDS, record.field);
    const onCompany = Boolean(row.company_id) && isOneOf(COMPANY_FACT_FIELDS, record.field);
    if (onRole || onCompany) out[record.field] = record;
  }
  return out;
}

/**
 * The origins of a role's facts, and of its company's stage when the company
 * is given. RLS scopes the read to the signed-in person; a service-role
 * caller passes userId so the read stays in one account.
 */
export async function loadRoleFactOrigins(
  supabase: AppSupabaseClient,
  roleId: string,
  companyId: string | null,
  userId?: string,
): Promise<RoleFactOrigins> {
  let query = supabase.from('fact_origins').select(FACT_ORIGIN_COLUMNS);
  query = companyId ? query.or(`role_id.eq.${roleId},company_id.eq.${companyId}`) : query.eq('role_id', roleId);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw new Error(`fact origins for role ${roleId}: ${error.message}`);
  return roleFactOrigins((data ?? []) as Row[]);
}

/** The origin and certainty roles.comp_source stands for, as the backfill mapped it. */
export function originFromCompSource(
  source: 'posted' | 'recruiter' | 'estimate' | null,
): { origin: FactOrigin; certainty: FactCertainty | null } {
  switch (source) {
    case 'posted':
      return { origin: 'posting', certainty: 'firsthand' };
    case 'recruiter':
      return { origin: 'recruiter_email', certainty: 'secondhand' };
    case 'estimate':
      return { origin: 'dash', certainty: 'guess' };
    default:
      return { origin: 'unknown', certainty: null };
  }
}
