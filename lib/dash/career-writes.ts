import { isUuid, type AskDb } from '@/lib/ask/db';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments/rules';
import { toRef } from '@/lib/core/refs';
import { formatCount } from '@/lib/money';
import { ensureCompany } from '@/lib/jobs/companies/ensure';
import { APP_STORAGE_BUCKET, type AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { normalizeSkills } from '@/lib/jobs/evidence/propose-payload';
import { RESUME_MAX_BYTES, resumePath } from '@/lib/jobs/resume-file';
import { slugify } from '@/lib/jobs/slug';
import { THOUGHT_MAX } from '@/lib/jobs/thoughts';
import { JobsRefused } from './jobs-refused';
import type { JobsMade, JobsWrite, JobsWriteEnv } from './jobs-writes';

/**
 * The Jobs changes an agent makes from Material, Settings and Find (plan
 * #1894.6.7, feature #1894.6), the ones those pages let the person make by
 * hand:
 *
 *   add_evidence            a story for the evidence bank.
 *   add_resume_version      a resume version, as text, with a PDF they sent
 *                           Dash if they gave one.
 *   attach_resume_pdf       a PDF they sent Dash kept as an existing
 *                           version's file.
 *   change_career_thought   a career goals entry written or edited.
 *   add_discovered_company  a startup Find discovered added to their companies.
 *
 * They run in JOBS_WRITES (lib/dash/jobs-writes.ts), so Ask and the
 * connector both have them. All but the last add or change one row, and the
 * one undo rule in lib/core/dash-actions.ts puts that row back (#1894.4).
 * Attaching a PDF leaves the version's earlier file where it was, unlike the
 * page's replace, so that Undo points the version back at a file that is
 * still there.
 *
 * A PDF comes from core.attachments: the files sent with a question to Ask
 * Dash, or added to any row (lib/attachments/store.ts). It is copied into the
 * version's place in the job-search bucket (lib/jobs/resume-file.ts), since
 * /jobs/resume/<id> signs links there and nowhere else.
 *
 * add_discovered_company makes a companies row when none has the startup's
 * name and points the Find row at it, as the page's "Add to my companies"
 * does. Its record keeps both in `undo` (DiscoveredUndo), and
 * undoDiscoveredCompany takes the company out again only while nothing hangs
 * on it.
 */

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const EVIDENCE = 'job_search.evidence_items';
const RESUMES = 'job_search.resume_versions';
const THOUGHTS = 'job_search.thoughts';
const WATCHLIST = 'job_search.watchlist_startups';

const EVIDENCE_HREF = '/jobs/material?part=evidence';
const RESUMES_HREF = '/jobs/material?part=resumes';
const THOUGHTS_HREF = '/jobs/settings#career-goals';

/** The limits the evidence form and the resume form set. */
const EVIDENCE_TITLE_MAX = 160;
const EVIDENCE_LINE_MAX = 400;
const EVIDENCE_BODY_MAX = 20_000;
const RESUME_LABEL_MAX = 60;
const RESUME_NOTES_MAX = 400;
const RESUME_TEXT_MAX = 100_000;

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function capped(args: Args, key: string, max: number): string | null {
  const value = text(args, key);
  if (value.length > max) throw new JobsRefused(`Keep ${key} under ${formatCount(max)} characters.`);
  return value || null;
}

function idOf(value: string, what: string): string {
  if (!isUuid(value)) throw new JobsRefused(`That is not a ${what}'s ref, as a lookup returned it.`);
  return value;
}

async function ownRow(env: JobsWriteEnv, table: string, id: string, what: string): Promise<Row> {
  const { data, error } = await env.jobs.from(table).select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading the ${what} failed: ${error.message}`);
  if (!data) throw new JobsRefused(`There is no ${what} of theirs with that ref. Look it up first.`);
  return data as Row;
}

/** A line of theirs quoted in a sentence, cut short. */
function quoted(value: unknown, fallback: string, max = 80): string {
  const line = typeof value === 'string' ? value.trim().split('\n')[0].trim() : '';
  if (!line) return fallback;
  return `"${line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line}"`;
}

// ---------------------------------------------------------------------------
// add_evidence
// ---------------------------------------------------------------------------

function skillsOf(args: Args): string[] {
  const value = args.skills;
  if (value === undefined || value === null || value === '') return [];
  const raw = typeof value === 'string' ? value.split(/[,\n]/) : Array.isArray(value) ? value : null;
  if (!raw || raw.some((entry) => typeof entry !== 'string')) throw new JobsRefused('skills must be a list of words, such as ["sql", "data modelling"].');
  return normalizeSkills(raw as string[]);
}

/** A story for the evidence bank, as the Material page's form adds one. */
async function addEvidence(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const title = text(args, 'title');
  if (!title) throw new JobsRefused('Give title: a short handle for the story.');
  if (title.length > EVIDENCE_TITLE_MAX) throw new JobsRefused(`Keep title under ${EVIDENCE_TITLE_MAX} characters.`);
  const body = text(args, 'body');
  if (!body) throw new JobsRefused('Give body: the story, in their words.');
  if (body.length > EVIDENCE_BODY_MAX) throw new JobsRefused(`Keep body under ${formatCount(EVIDENCE_BODY_MAX)} characters.`);
  let strength = 3;
  if (args.strength !== undefined && args.strength !== null) {
    if (typeof args.strength !== 'number' || !Number.isInteger(args.strength) || args.strength < 1 || args.strength > 5) {
      throw new JobsRefused('strength must be a whole number from 1 to 5.');
    }
    strength = args.strength;
  }
  const values = {
    user_id: env.userId,
    title,
    body,
    context: capped(args, 'context', EVIDENCE_LINE_MAX),
    metrics: capped(args, 'metrics', EVIDENCE_LINE_MAX),
    strength,
    skills: skillsOf(args),
  };
  const { data, error } = await env.jobs.from('evidence_items').insert(values).select('*').single();
  if (error || !data) throw new Error(`Adding the evidence failed: ${error?.message ?? 'no row'}`);
  const row = data as Row;
  const name = quoted(row.title, 'a story');
  return {
    kind: 'add_evidence',
    input: { verb: 'Added', what: name, rest: ' to your evidence bank', href: EVIDENCE_HREF, where: 'Open Material', paths: ['/jobs/material'] },
    subjectRef: toRef(EVIDENCE, row.id as string),
    op: 'insert',
    before: null,
    after: row,
    summary: `Dash added ${name} to the evidence bank.`,
    row: { table: EVIDENCE, ref: row.id as string, title: String(row.title), href: EVIDENCE_HREF },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// A PDF they sent Dash, copied to a resume version's place
// ---------------------------------------------------------------------------

/** The PDF a call names, among the files they have sent Dash or added to a row: by its id, or by its name, newest first. */
async function sentPdf(env: JobsWriteEnv, args: Args): Promise<{ path: string; name: string; size: number }> {
  const ref = text(args, 'file_ref');
  const name = text(args, 'file_name');
  if (!ref && !name) throw new JobsRefused('Name the PDF: file_name, as it was sent, or file_ref.');
  let query = env.core
    .from('attachments')
    .select('id, path, name, content_type, size_bytes, created_at')
    .eq('user_id', env.userId);
  query = ref ? query.eq('id', idOf(ref, 'file')) : query.eq('name', name);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(`Reading their files failed: ${error.message}`);
  const file = ((data ?? []) as Row[])[0];
  if (!file) throw new JobsRefused(`There is no file of theirs ${ref ? 'with that ref' : `named "${name}"`}. They can send the PDF with their question.`);
  if (file.content_type !== 'application/pdf') throw new JobsRefused(`${String(file.name)} is not a PDF. A resume version keeps a PDF.`);
  const size = Number(file.size_bytes);
  if (size > RESUME_MAX_BYTES) throw new JobsRefused(`${String(file.name)} is over 10 MB, the most a resume version keeps.`);
  return { path: String(file.path), name: String(file.name), size };
}

/** Copy the PDF to a fresh place in their resumes folder; the path it went to. */
async function copyPdf(env: JobsWriteEnv, file: { path: string; name: string }): Promise<string> {
  const { data, error } = await env.core.storage.from(ATTACHMENTS_BUCKET).download(file.path);
  if (error || !data) throw new Error(`Fetching ${file.name} failed: ${error?.message ?? 'no file'}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (new TextDecoder('latin1').decode(bytes.slice(0, 5)) !== '%PDF-') throw new JobsRefused(`${file.name} does not open as a PDF.`);
  const path = resumePath(env.userId, crypto.randomUUID());
  const { error: uploadError } = await env.jobs.storage
    .from(APP_STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw new Error(`Keeping ${file.name} failed: ${uploadError.message}`);
  return path;
}

/** Take back a copy no row came to point at. A file left behind costs a little storage, so a failure is logged. */
async function dropCopy(env: JobsWriteEnv, path: string): Promise<void> {
  const { error } = await env.jobs.storage.from(APP_STORAGE_BUCKET).remove([path]);
  if (error) console.error('resume write: removing an unused copy failed', error.message);
}

// ---------------------------------------------------------------------------
// add_resume_version, attach_resume_pdf
// ---------------------------------------------------------------------------

/** A resume version, as the Material page's form adds one: a label, notes, its text, and the PDF if they sent one. */
async function addResumeVersion(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const label = text(args, 'label');
  if (!label) throw new JobsRefused('Give label: what this version is, such as "Data engineering, Oct 2026".');
  if (label.length > RESUME_LABEL_MAX) throw new JobsRefused(`Keep label under ${RESUME_LABEL_MAX} characters.`);
  const notes = capped(args, 'notes', RESUME_NOTES_MAX);
  const textContent = capped(args, 'text_content', RESUME_TEXT_MAX);
  const withFile = !!(text(args, 'file_name') || text(args, 'file_ref'));
  if (!textContent && !withFile) throw new JobsRefused('Give text_content, the resume as text, or the PDF they sent as file_name.');

  const { data: same, error: sameError } = await env.jobs.from('resume_versions').select('id').eq('user_id', env.userId).eq('label', label);
  if (sameError) throw new Error(`Reading their resume versions failed: ${sameError.message}`);
  if ((same ?? []).length > 0) throw new JobsRefused(`They already have a version labelled "${label}". Pick another label, or attach the PDF to that one.`);

  const file = withFile ? await sentPdf(env, args) : null;
  const storagePath = file ? await copyPdf(env, file) : null;
  const { data, error } = await env.jobs
    .from('resume_versions')
    .insert({ user_id: env.userId, label, notes, text_content: textContent, storage_path: storagePath })
    .select('*')
    .single();
  if (error || !data) {
    if (storagePath) await dropCopy(env, storagePath);
    if (error && /resume_versions_user_label_key/.test(error.message)) throw new JobsRefused(`They already have a version labelled "${label}".`);
    throw new Error(`Adding the resume version failed: ${error?.message ?? 'no row'}`);
  }
  const row = data as Row;
  const name = quoted(row.label, 'a resume version');
  const how = file ? `, with ${file.name}` : '';
  return {
    kind: 'add_resume_version',
    input: { verb: 'Added', what: name, rest: ` to your resume versions${how}`, href: RESUMES_HREF, where: 'Open Material', paths: ['/jobs/material'] },
    subjectRef: toRef(RESUMES, row.id as string),
    op: 'insert',
    before: null,
    after: row,
    summary: `Dash added the resume version ${name}${how}.`,
    row: { table: RESUMES, ref: row.id as string, title: String(row.label), href: RESUMES_HREF },
    undo: null,
  };
}

/** The version a call names: by its ref, or by its label. */
async function namedResume(env: JobsWriteEnv, args: Args): Promise<Row> {
  const ref = text(args, 'resume_ref');
  if (ref) return ownRow(env, 'resume_versions', idOf(ref, 'resume version'), 'resume version');
  const label = text(args, 'label');
  if (!label) throw new JobsRefused('Name the version: resume_ref, or label as it is on file.');
  const { data, error } = await env.jobs.from('resume_versions').select('*').eq('user_id', env.userId).ilike('label', label);
  if (error) throw new Error(`Reading their resume versions failed: ${error.message}`);
  const found = (data ?? []) as Row[];
  if (found.length === 1) return found[0];
  throw new JobsRefused(found.length === 0 ? `There is no resume version labelled "${label}". Look them up with list_rows on ${RESUMES}.` : `More than one version is labelled "${label}". Give resume_ref.`);
}

/**
 * Keep a PDF they sent as an existing version's file, as the Material page's
 * attach does. The file it had stays in storage, so Undo can point back at it.
 */
async function attachResumePdf(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const before = await namedResume(env, args);
  const file = await sentPdf(env, args);
  const storagePath = await copyPdf(env, file);
  const { data, error } = await env.jobs
    .from('resume_versions')
    .update({ storage_path: storagePath })
    .eq('id', before.id as string)
    .eq('user_id', env.userId)
    .select('*');
  const after = ((data ?? []) as Row[])[0];
  if (error || !after) {
    await dropCopy(env, storagePath);
    throw new Error(`Attaching the PDF failed: ${error?.message ?? 'no row'}`);
  }
  const name = quoted(after.label, 'the resume version');
  const replaced = before.storage_path ? ', in place of the PDF it had' : '';
  return {
    kind: 'attach_resume_pdf',
    input: { verb: 'Attached', what: file.name, rest: ` to the resume version ${name}${replaced}`, href: RESUMES_HREF, where: 'Open Material', paths: ['/jobs/material'] },
    subjectRef: toRef(RESUMES, after.id as string),
    op: 'update',
    before,
    after,
    summary: `Dash attached ${file.name} to the resume version ${name}${replaced}.`,
    row: { table: RESUMES, ref: after.id as string, title: String(after.label), href: RESUMES_HREF },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// change_career_thought
// ---------------------------------------------------------------------------

/**
 * A career goals entry on Settings: a new dated one, or one of theirs
 * reworded. The roles and people searches read them.
 */
async function changeCareerThought(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const body = text(args, 'body');
  if (!body) throw new JobsRefused('Give body: the entry, in their words.');
  if (body.length > THOUGHT_MAX) throw new JobsRefused(`Keep an entry under ${formatCount(THOUGHT_MAX)} characters.`);
  const ref = text(args, 'thought_ref');
  const before = ref ? await ownRow(env, 'thoughts', idOf(ref, 'career goals entry'), 'career goals entry') : null;
  if (before && before.body === body) throw new JobsRefused('That entry says that already.');

  const { data, error } = before
    ? await env.jobs.from('thoughts').update({ body }).eq('id', before.id as string).eq('user_id', env.userId).select('*')
    : await env.jobs.from('thoughts').insert({ user_id: env.userId, body }).select('*');
  const row = ((data ?? []) as Row[])[0];
  if (error || !row) throw new Error(`${before ? 'Changing' : 'Adding'} the entry failed: ${error?.message ?? 'no row'}`);
  const words = quoted(row.body, 'an entry', 60);
  return {
    kind: 'change_career_thought',
    input: {
      verb: before ? 'Reworded' : 'Added',
      what: words,
      rest: before ? ' in your career goals' : ' to your career goals',
      href: THOUGHTS_HREF,
      where: 'Open Settings',
      paths: ['/jobs/settings', '/jobs/find'],
    },
    subjectRef: toRef(THOUGHTS, row.id as string),
    op: before ? 'update' : 'insert',
    before,
    after: row,
    summary: before ? `Dash reworded a career goals entry to ${words}.` : `Dash added ${words} to the career goals.`,
    row: { table: THOUGHTS, ref: row.id as string, title: words, href: THOUGHTS_HREF },
    undo: null,
  };
}

// ---------------------------------------------------------------------------
// add_discovered_company
// ---------------------------------------------------------------------------

/** What add_discovered_company keeps in `undo`: the Find row, the company it now points at, and whether Dash made that company. */
export type DiscoveredUndo = { watchlist_id: string; company_id: string; added_company: boolean };

/** The startup a call names: by its ref, or by its name on Find. */
async function namedStartup(env: JobsWriteEnv, args: Args): Promise<Row> {
  const ref = text(args, 'startup_ref');
  if (ref) return ownRow(env, 'watchlist_startups', idOf(ref, 'startup'), 'startup on Find');
  const name = text(args, 'name');
  if (!name) throw new JobsRefused('Name the startup: name, as Find shows it, or startup_ref.');
  const { data, error } = await env.jobs
    .from('watchlist_startups')
    .select('*')
    .eq('user_id', env.userId)
    .ilike('name', name.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (error) throw new Error(`Reading the startups on Find failed: ${error.message}`);
  const found = (data ?? []) as Row[];
  if (found.length === 1) return found[0];
  throw new JobsRefused(found.length === 0 ? `No startup on Find is called "${name}".` : `More than one startup on Find is called "${name}". Give startup_ref.`);
}

/**
 * "Add to my companies" on a startup Find discovered: it becomes a companies
 * row with its website and job board, so the roles search reads its board
 * every day, and the Find row points at it. One already on file under that
 * name is linked rather than added again.
 */
async function addDiscoveredCompany(env: JobsWriteEnv, args: Args): Promise<JobsMade> {
  const startup = await namedStartup(env, args);
  const name = String(startup.name);
  if (startup.company_id) throw new JobsRefused(`${name} is in their companies already.`);

  const { data: held, error: heldError } = await env.jobs.from('companies').select('id').eq('user_id', env.userId).eq('slug', slugify(name)).maybeSingle();
  if (heldError) throw new Error(`Reading their companies failed: ${heldError.message}`);
  const company = await ensureCompany(env.jobs as unknown as AppSupabaseClient, env.userId, name, {
    website: (startup.website as string | null) ?? null,
    boardToken: (startup.board_token as string | null) ?? null,
    ats: (startup.board_vendor as string | null) ?? null,
  });
  if (company.error) throw new Error(`Adding the company failed: ${company.error}`);
  const undo: DiscoveredUndo = { watchlist_id: startup.id as string, company_id: company.id, added_company: !held };

  const { data, error } = await env.jobs
    .from('watchlist_startups')
    .update({ company_id: company.id })
    .eq('id', startup.id as string)
    .eq('user_id', env.userId)
    .is('company_id', null)
    .select('*');
  const after = ((data ?? []) as Row[])[0];
  if (error || !after) {
    if (undo.added_company) await putBackDiscovered({ userId: env.userId, db: async () => env.jobs }, { ...undo, watchlist_id: '' });
    if (error) throw new Error(`Linking the startup failed: ${error.message}`);
    throw new JobsRefused(`${name} was added to their companies while this ran.`);
  }

  const { data: slugRow } = await env.jobs.from('companies').select('slug').eq('id', company.id).eq('user_id', env.userId).maybeSingle();
  const slug = ((slugRow as Row | null)?.slug as string | undefined) ?? slugify(name);
  const href = `/jobs/companies/${slug}`;
  return {
    kind: 'add_discovered_company',
    input: {
      verb: 'Added',
      what: name,
      rest: undo.added_company ? ' to your companies, from Find' : ', from Find, to the company you had on file',
      href,
      where: 'Open the company',
      paths: ['/jobs/find', '/jobs/companies', href],
    },
    subjectRef: toRef(WATCHLIST, startup.id as string),
    op: 'update',
    before: startup,
    after,
    summary: undo.added_company
      ? `Dash added ${name} to the companies from Find, so the roles search reads its job board.`
      : `Dash linked ${name} on Find to the company already on file.`,
    row: { table: 'job_search.companies', ref: company.id, title: name, href },
    undo: undo as unknown as Record<string, unknown>,
  };
}

function discoveredUndo(value: Record<string, unknown> | null): DiscoveredUndo | null {
  if (!value) return null;
  const { watchlist_id, company_id, added_company } = value;
  if (typeof watchlist_id !== 'string' || !isUuid(watchlist_id) || typeof company_id !== 'string' || !isUuid(company_id)) return null;
  return { watchlist_id, company_id, added_company: added_company === true };
}

/** The rows that hang on a company and would go with it, or lose it, if it were taken out. */
const COMPANY_HOLDERS: readonly { schema: 'job_search' | 'todo'; table: string; owned: boolean }[] = [
  { schema: 'job_search', table: 'roles', owned: true },
  { schema: 'job_search', table: 'notes', owned: true },
  { schema: 'job_search', table: 'contacts', owned: true },
  { schema: 'job_search', table: 'attachments', owned: true },
  { schema: 'job_search', table: 'suggestions', owned: true },
  { schema: 'job_search', table: 'watchlist_startups', owned: true },
  { schema: 'todo', table: 'task_links', owned: false },
];

export async function companyHeld(deps: { userId: string; db: AskDb }, companyId: string): Promise<boolean> {
  for (const holder of COMPANY_HOLDERS) {
    let query = (await deps.db(holder.schema)).from(holder.table).select('id').eq('company_id', companyId);
    if (holder.owned) query = query.eq('user_id', deps.userId);
    const { data, error } = await query.limit(1);
    if (error) throw new Error(`${holder.table}: ${error.message}`);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

/** Point the Find row back at nothing while it still points where Dash left it, then take out a company Dash made that nothing holds. */
async function putBackDiscovered(deps: { userId: string; db: AskDb }, undo: DiscoveredUndo): Promise<number> {
  const jobs = await deps.db('job_search');
  let restored = 0;
  if (undo.watchlist_id) {
    const { data, error } = await jobs
      .from('watchlist_startups')
      .update({ company_id: null })
      .eq('id', undo.watchlist_id)
      .eq('user_id', deps.userId)
      .eq('company_id', undo.company_id)
      .select('id');
    if (error) throw new Error(`watchlist_startups: ${error.message}`);
    restored += (data ?? []).length;
    if (restored === 0) return 0;
  }
  if (undo.added_company && !(await companyHeld(deps, undo.company_id))) {
    const { data, error } = await jobs.from('companies').delete().eq('id', undo.company_id).eq('user_id', deps.userId).select('id');
    if (error) throw new Error(`companies: ${error.message}`);
    restored += (data ?? []).length;
  }
  return restored;
}

/**
 * Undo a startup added from Find (DiscoveredUndo). The company Dash made
 * stays when anything has come to hang on it since, such as a role the
 * search found on its board. Ask's undo calls it for every surface
 * (lib/ask/changes.ts, undoMany).
 */
export async function undoDiscoveredCompany(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true; restored: number } | { ok: false; error: string }> {
  const undo = discoveredUndo(recorded);
  if (!undo) return { ok: false, error: 'Dash did not keep what this changed, so it cannot be undone.' };
  const restored = await putBackDiscovered(deps, undo);
  if (restored === 0) return { ok: false, error: 'The startup on Find has changed again since, so undoing would lose the later change.' };
  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const PDF_BY_NAME = {
  type: 'string',
  description: 'The PDF they sent you, by its name as it was sent (the newest of that name).',
} as const;
const PDF_BY_REF = { type: 'string', description: 'Instead of file_name: the core.attachments id of the PDF.' } as const;

export const CAREER_WRITES: readonly JobsWrite[] = [
  {
    name: 'add_evidence',
    description:
      "Add a story to their evidence bank on Material when they ask: a piece of their own work and its result, which applications and drafts draw on. Write it in their words; do not invent results they did not give.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `A short handle for the story, under ${EVIDENCE_TITLE_MAX} characters.` },
        body: { type: 'string', description: 'The story, in their words.' },
        context: { type: 'string', description: 'Where and when, such as the job and the year.' },
        metrics: { type: 'string', description: 'The numbers that show the result, if they gave any.' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Up to eight skills it shows, such as "sql".' },
        strength: { type: 'integer', description: 'How strong a story it is, 1 to 5; 3 when they do not say.' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    run: addEvidence,
  },
  {
    name: 'add_resume_version',
    description:
      'Add a resume version on Material when they ask: a label, the resume as text, notes, and the PDF if they sent you one (by file_name). A label they already use is refused; to give an existing version a PDF, call attach_resume_pdf.',
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: `What this version is, under ${RESUME_LABEL_MAX} characters.` },
        text_content: { type: 'string', description: 'The resume as text; read it from the PDF they sent when they gave one.' },
        notes: { type: 'string', description: 'A line on what it is for.' },
        file_name: PDF_BY_NAME,
        file_ref: PDF_BY_REF,
      },
      required: ['label'],
      additionalProperties: false,
    },
    run: addResumeVersion,
  },
  {
    name: 'attach_resume_pdf',
    description:
      "Keep a PDF they sent you as an existing resume version's file, replacing the one it had, when they ask. Name the version by resume_ref (list_rows on job_search.resume_versions) or by its label, and the PDF by file_name.",
    input_schema: {
      type: 'object',
      properties: {
        resume_ref: { type: 'string', description: 'The job_search.resume_versions ref.' },
        label: { type: 'string', description: "Instead of resume_ref: the version's label as it is on file." },
        file_name: PDF_BY_NAME,
        file_ref: PDF_BY_REF,
      },
      additionalProperties: false,
    },
    run: attachResumePdf,
  },
  {
    name: 'change_career_thought',
    description:
      'Write a career goals entry on Jobs Settings when they ask (what they want from the next job, where they are now), or reword one of theirs by thought_ref (list_rows on job_search.thoughts). A new entry is dated today and older ones stay as they were. The roles and people searches read them.',
    input_schema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'The entry, in their words, in full.' },
        thought_ref: { type: 'string', description: 'The job_search.thoughts ref, to reword that entry. Leave it out to add one.' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    run: changeCareerThought,
  },
  {
    name: 'add_discovered_company',
    description:
      "Add a startup Find discovered to their companies when they ask, as Find's \"Add to my companies\" does: it becomes a company with its website and job board, so the roles search reads that board every day. Name it by its name as Find shows it, or startup_ref.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The startup, by its name on Find.' },
        startup_ref: { type: 'string', description: 'Instead of name: the job_search.watchlist_startups ref.' },
      },
      additionalProperties: false,
    },
    run: addDiscoveredCompany,
  },
];
