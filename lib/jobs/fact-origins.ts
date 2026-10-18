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

// ---------------------------------------------------------------------------
// Writing origins (plan #2343.2)
// ---------------------------------------------------------------------------

/** An origin a writer records; unknown is only ever the backfill's. */
export type FactSource = {
  origin: Exclude<FactOrigin, 'unknown'>;
  certainty: FactCertainty;
  messageId?: string | null;
  sourceUrl?: string | null;
};

/** What a write did to one fact: gave it a value from a source, or emptied it. */
export type FactWrite = { field: RoleFactField; source: FactSource } | { field: RoleFactField; cleared: true };

/** A fact an update changed, before a source is put to it. */
export type ChangedFact = { field: RoleFactField; cleared: boolean };

type OnFile = { id: string; field: string; origin: string; certainty: string | null };

const CERTAINTY_RANK: Record<FactCertainty, number> = { guess: 1, secondhand: 2, firsthand: 3 };

/**
 * Whether a write as certain as `next` may replace the origin on file. A later
 * write replaces it only when it is at least as certain, so a guess never
 * replaces a posted or recruiter-given fact. An unknown origin, or none, is
 * replaced by anything.
 */
export function mayReplace(existing: { origin: string; certainty: string | null } | null, next: FactCertainty): boolean {
  if (!existing || existing.origin === 'unknown' || !isOneOf(FACT_CERTAINTIES, existing.certainty)) return true;
  return CERTAINTY_RANK[next] >= CERTAINTY_RANK[existing.certainty];
}

const blank = (value: unknown): boolean => value == null || (typeof value === 'string' && !value.trim());

/**
 * The facts an update to a role changes, compared with the row before it:
 * each field whose value moved, as cleared when it is now empty. Pay is one
 * fact over comp_min_cents, comp_max_cents and comp_source. A posting status
 * of unknown counts as empty, as the backfill counted it. A column the update
 * leaves out, or sets to the value it had, is no change, so a form that sends
 * every field on each save records only what was edited.
 */
export function changedRoleFacts(before: Record<string, unknown>, update: Record<string, unknown>): ChangedFact[] {
  const now = (column: string) => (column in update ? update[column] : before[column]);
  const moved = (column: string) => column in update && (update[column] ?? null) !== (before[column] ?? null);
  const out: ChangedFact[] = [];
  for (const field of ['location', 'work_mode', 'seniority'] as const) {
    if (moved(field)) out.push({ field, cleared: blank(now(field)) });
  }
  if (moved('posting_status')) {
    out.push({ field: 'posting_status', cleared: blank(now('posting_status')) || now('posting_status') === 'unknown' });
  }
  if (moved('comp_min_cents') || moved('comp_max_cents') || moved('comp_source')) {
    out.push({ field: 'comp', cleared: now('comp_min_cents') == null && now('comp_max_cents') == null });
  }
  return out;
}

/** The writes for the facts an update changed, each one given a value taking `sourceFor(field)`. */
export function factWrites(changed: readonly ChangedFact[], sourceFor: (field: RoleFactField) => FactSource): FactWrite[] {
  return changed.map(({ field, cleared }) => (cleared ? { field, cleared: true as const } : { field, source: sourceFor(field) }));
}

async function originsOnFile(
  supabase: AppSupabaseClient,
  userId: string,
  roleId: string,
  fields: readonly RoleFactField[],
): Promise<Map<string, OnFile>> {
  const { data, error } = await supabase
    .from('fact_origins')
    .select('id, field, origin, certainty')
    .eq('user_id', userId)
    .eq('role_id', roleId)
    .in('field', [...fields]);
  if (error) throw new Error(`fact origins for role ${roleId}: ${error.message}`);
  return new Map(((data ?? []) as OnFile[]).map((row) => [row.field, row]));
}

/**
 * The fields among `writes` whose origin on file is more certain than the
 * write's, which a writer that has not yet saved the value can refuse
 * (Dash's change_role does).
 */
export async function moreCertainOnFile(
  supabase: AppSupabaseClient,
  userId: string,
  roleId: string,
  writes: readonly FactWrite[],
): Promise<{ field: RoleFactField; origin: FactOrigin; certainty: FactCertainty }[]> {
  const given = writes.filter((write): write is Extract<FactWrite, { source: FactSource }> => 'source' in write);
  if (given.length === 0) return [];
  const onFile = await originsOnFile(supabase, userId, roleId, given.map((write) => write.field));
  const out: { field: RoleFactField; origin: FactOrigin; certainty: FactCertainty }[] = [];
  for (const write of given) {
    const existing = onFile.get(write.field) ?? null;
    if (existing && !mayReplace(existing, write.source.certainty)) {
      out.push({ field: write.field, origin: existing.origin as FactOrigin, certainty: existing.certainty as FactCertainty });
    }
  }
  return out;
}

/**
 * Record where a role's facts came from, once the values are written. A fact
 * given a value takes its source unless the origin on file is more certain
 * (mayReplace), and an emptied fact loses its row, since an empty fact has
 * none. `force` is for the person's own edits, which replace whatever was
 * there. Every read and write names the user, since the connector's
 * service-role client passes no row level security. The unique indexes are
 * partial, which PostgREST's on_conflict cannot name, so this reads the rows
 * and then updates or inserts each one.
 *
 * Returns the fields recorded and the fields whose more certain origin was kept.
 */
export async function recordRoleFactOrigins(
  supabase: AppSupabaseClient,
  userId: string,
  roleId: string,
  writes: readonly FactWrite[],
  options: { force?: boolean; now?: Date } = {},
): Promise<{ recorded: RoleFactField[]; kept: RoleFactField[] }> {
  const recorded: RoleFactField[] = [];
  const kept: RoleFactField[] = [];
  if (writes.length === 0) return { recorded, kept };

  const onFile = await originsOnFile(supabase, userId, roleId, writes.map((write) => write.field));
  const recordedAt = (options.now ?? new Date()).toISOString();

  for (const write of writes) {
    const existing = onFile.get(write.field) ?? null;
    if ('cleared' in write) {
      if (existing) {
        const { error } = await supabase.from('fact_origins').delete().eq('id', existing.id).eq('user_id', userId);
        if (error) throw new Error(`clearing the origin of ${write.field}: ${error.message}`);
      }
      recorded.push(write.field);
      continue;
    }
    if (!options.force && !mayReplace(existing, write.source.certainty)) {
      kept.push(write.field);
      continue;
    }
    const row = {
      origin: write.source.origin,
      certainty: write.source.certainty,
      message_id: write.source.messageId ?? null,
      source_url: write.source.sourceUrl ?? null,
      recorded_at: recordedAt,
    };
    const { error } = existing
      ? await supabase.from('fact_origins').update(row).eq('id', existing.id).eq('user_id', userId)
      : await supabase.from('fact_origins').insert({ user_id: userId, role_id: roleId, field: write.field, ...row });
    if (error) throw new Error(`recording the origin of ${write.field}: ${error.message}`);
    recorded.push(write.field);
  }
  return { recorded, kept };
}

/**
 * The origins of the person's own edit on the role page (updateRole). What
 * they typed is theirs and firsthand, and replaces any origin on file. Pay
 * keeps the certainty of the source they picked for it: heard from a
 * recruiter is secondhand, an estimate a guess. Pay read from a description
 * they pasted came from the posting. A failure is logged, since the edit
 * itself saved.
 */
export async function recordHandEditOrigins(
  supabase: AppSupabaseClient,
  userId: string,
  roleId: string,
  before: Record<string, unknown>,
  update: Record<string, unknown>,
  options: { payFromPosting?: boolean; now?: Date } = {},
): Promise<void> {
  const compSource = 'comp_source' in update ? update.comp_source : before.comp_source;
  const writes = factWrites(changedRoleFacts(before, update), (field): FactSource => {
    if (field !== 'comp') return { origin: 'you', certainty: 'firsthand' };
    if (options.payFromPosting) return { origin: 'posting', certainty: 'firsthand' };
    return { origin: 'you', certainty: compSource === 'recruiter' ? 'secondhand' : compSource === 'estimate' ? 'guess' : 'firsthand' };
  });
  try {
    await recordRoleFactOrigins(supabase, userId, roleId, writes, { force: true, now: options.now });
  } catch (error) {
    console.error('role edit: recording where the facts came from failed', error);
  }
}
