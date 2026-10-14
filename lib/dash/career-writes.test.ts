import { describe, expect, it } from 'vitest';
import type { AskSchema, SchemaClient } from '@/lib/ask/db';
import { fakeSchemaDb, type FakeTables } from '../../tests/stubs/fake-schema-db';
import { CAREER_WRITES, undoDiscoveredCompany } from './career-writes';
import { JOBS_WRITES, runJobsWrite, type JobsWriteEnv } from './jobs-writes';

/**
 * The Jobs writes from Material, Settings and Find (plan #1894.6.7): each
 * reads the person's rows by their user id, a PDF comes from the files they
 * sent Dash, and a startup added from Find keeps what its Undo needs.
 */

const ME = '00000000-0000-4000-8000-0000000000aa';
const SOMEONE = '00000000-0000-4000-8000-0000000000bb';
const RESUME = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const THOUGHT = '33333333-3333-4333-8333-333333333333';
const STARTUP = '44444444-4444-4444-8444-444444444444';
const COMPANY = '55555555-5555-4555-8555-555555555555';

const PDF = new TextEncoder().encode('%PDF-1.7 a resume');

type Stored = { bucket: string; path: string; bytes: Uint8Array };

function storage(files: Stored[]) {
  return {
    from: (bucket: string) => ({
      download: async (path: string) => {
        const file = files.find((f) => f.bucket === bucket && f.path === path);
        return file ? { data: new Blob([file.bytes as BlobPart]), error: null } : { data: null, error: { message: 'not found' } };
      },
      upload: async (path: string, bytes: Uint8Array) => {
        files.push({ bucket, path, bytes });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) files.splice(files.findIndex((f) => f.bucket === bucket && f.path === path), 1);
        return { data: [], error: null };
      },
    }),
  };
}

function env(tables: FakeTables, files: Stored[] = []): JobsWriteEnv {
  const db = fakeSchemaDb(tables);
  const withStorage = (client: SchemaClient) => ({ ...client, storage: storage(files) }) as unknown as SchemaClient;
  return { userId: ME, jobs: withStorage(db('job_search')), todo: db('todo'), core: withStorage(db('core')) };
}

const write = (name: string) => CAREER_WRITES.find((entry) => entry.name === name)!;

async function made(name: string, tables: FakeTables, input: Record<string, unknown>, files: Stored[] = []) {
  const result = await runJobsWrite(write(name), env(tables, files), input);
  if ('ok' in result) throw new Error(result.error);
  return result;
}

async function refused(name: string, tables: FakeTables, input: Record<string, unknown>, files: Stored[] = []) {
  const result = await runJobsWrite(write(name), env(tables, files), input);
  if (!('ok' in result)) throw new Error('expected a refusal');
  return result.error;
}

function sent(): { tables: FakeTables; files: Stored[] } {
  return {
    tables: {
      'core.attachments': [
        { id: FILE, user_id: ME, ref: 'core.conversation_turns:x', path: `${ME}/${FILE}-resume.pdf`, name: 'resume.pdf', content_type: 'application/pdf', size_bytes: PDF.length, created_at: '2026-10-14T08:00:00Z' },
      ],
      'job_search.resume_versions': [{ id: RESUME, user_id: ME, label: 'General', storage_path: `${ME}/resumes/old.pdf`, text_content: 'old' }],
    },
    files: [{ bucket: 'attachments', path: `${ME}/${FILE}-resume.pdf`, bytes: PDF }],
  };
}

describe('the career writes', () => {
  it('run among the Jobs writes, last', () => {
    expect(JOBS_WRITES.slice(-CAREER_WRITES.length)).toEqual([...CAREER_WRITES]);
  });

  it('adds a story to the evidence bank, with its skills as the form keeps them', async () => {
    const tables: FakeTables = { 'job_search.evidence_items': [] };
    const change = await made('add_evidence', tables, { title: 'Cut the batch', body: 'I rewrote the nightly job.', skills: ['SQL', 'data modelling'], strength: 4 });
    expect(change.op).toBe('insert');
    expect(tables['job_search.evidence_items'][0]).toMatchObject({ user_id: ME, title: 'Cut the batch', skills: ['sql', 'data_modelling'], strength: 4, context: null });
    expect(change.subjectRef).toBe(`job_search.evidence_items:${tables['job_search.evidence_items'][0].id}`);
    expect(change.summary).toBe('Dash added "Cut the batch" to the evidence bank.');
    expect(await refused('add_evidence', tables, { title: 'x' })).toMatch(/Give body/);
    expect(await refused('add_evidence', tables, { title: 'x', body: 'y', strength: 9 })).toMatch(/1 to 5/);
  });

  it('adds a resume version with the PDF they sent, copied to their resumes folder', async () => {
    const { tables, files } = sent();
    const change = await made('add_resume_version', tables, { label: 'Data, Oct 2026', file_name: 'resume.pdf', text_content: 'Jo Park' }, files);
    const row = tables['job_search.resume_versions'][1];
    expect(row).toMatchObject({ user_id: ME, label: 'Data, Oct 2026', text_content: 'Jo Park' });
    expect(row.storage_path).toMatch(new RegExp(`^${ME}/resumes/[0-9a-f-]{36}\\.pdf$`));
    expect(files.some((f) => f.bucket === 'job-search' && f.path === row.storage_path)).toBe(true);
    expect(change.summary).toBe('Dash added the resume version "Data, Oct 2026", with resume.pdf.');
  });

  it('refuses a label in use, a file that is not theirs, and nothing to keep', async () => {
    const { tables, files } = sent();
    expect(await refused('add_resume_version', tables, { label: 'General', text_content: 'x' }, files)).toMatch(/already have a version/);
    expect(await refused('add_resume_version', tables, { label: 'New' }, files)).toMatch(/Give text_content/);
    tables['core.attachments'][0].user_id = SOMEONE;
    expect(await refused('add_resume_version', tables, { label: 'New', file_name: 'resume.pdf' }, files)).toMatch(/no file of theirs/);
  });

  it('attaches a PDF to a version and keeps the file it had, for the Undo', async () => {
    const { tables, files } = sent();
    const change = await made('attach_resume_pdf', tables, { label: 'general', file_ref: FILE }, files);
    expect(change.op).toBe('update');
    expect(change.before).toMatchObject({ storage_path: `${ME}/resumes/old.pdf` });
    expect(tables['job_search.resume_versions'][0].storage_path).not.toBe(`${ME}/resumes/old.pdf`);
    expect(change.summary).toBe('Dash attached resume.pdf to the resume version "General", in place of the PDF it had.');
  });

  it('refuses a file that is not a PDF', async () => {
    const { tables, files } = sent();
    tables['core.attachments'][0].content_type = 'image/png';
    expect(await refused('attach_resume_pdf', tables, { resume_ref: RESUME, file_ref: FILE }, files)).toMatch(/not a PDF/);
  });

  it('writes a career goals entry, and rewords one of theirs', async () => {
    const tables: FakeTables = { 'job_search.thoughts': [{ id: THOUGHT, user_id: ME, body: 'Platform work.' }] };
    const added = await made('change_career_thought', tables, { body: 'Data platform roles in London.' });
    expect(added.op).toBe('insert');
    expect(tables['job_search.thoughts']).toHaveLength(2);
    const edited = await made('change_career_thought', tables, { thought_ref: THOUGHT, body: 'Platform or infra work.' });
    expect(edited).toMatchObject({ op: 'update', before: { body: 'Platform work.' } });
    expect(tables['job_search.thoughts'][0].body).toBe('Platform or infra work.');
    tables['job_search.thoughts'][0].user_id = SOMEONE;
    expect(await refused('change_career_thought', tables, { thought_ref: THOUGHT, body: 'x' })).toMatch(/no career goals entry of theirs/);
  });
});

describe('add_discovered_company (plan #1894.6.7)', () => {
  function find(): FakeTables {
    return {
      'job_search.companies': [],
      'job_search.watchlist_startups': [
        { id: STARTUP, user_id: ME, name: 'Tiny Labs', website: 'https://tinylabs.dev', board_vendor: 'ashby', board_token: 'tinylabs', company_id: null },
      ],
    };
  }

  const deps = (tables: FakeTables) => {
    const db = fakeSchemaDb(tables);
    return { userId: ME, db: async (schema: AskSchema) => db(schema) };
  };

  it('adds the startup as a company and points Find at it, and the Undo takes both back', async () => {
    const tables = find();
    const change = await made('add_discovered_company', tables, { name: 'tiny labs' });
    const company = tables['job_search.companies'][0];
    expect(company).toMatchObject({ user_id: ME, name: 'Tiny Labs', slug: 'tiny-labs' });
    expect(tables['job_search.watchlist_startups'][0].company_id).toBe(company.id);
    expect(change.undo).toEqual({ watchlist_id: STARTUP, company_id: company.id, added_company: true });
    expect(change.row.href).toBe('/jobs/companies/tiny-labs');

    const undone = await undoDiscoveredCompany(deps(tables), change.undo);
    expect(undone).toEqual({ ok: true, restored: 2 });
    expect(tables['job_search.watchlist_startups'][0].company_id).toBeNull();
    expect(tables['job_search.companies']).toHaveLength(0);
  });

  it('links a company already on file, and its Undo leaves that company', async () => {
    const tables = find();
    tables['job_search.companies'].push({ id: COMPANY, user_id: ME, name: 'Tiny Labs', slug: 'tiny-labs', domains: [] });
    const change = await made('add_discovered_company', tables, { startup_ref: STARTUP });
    expect(change.undo).toEqual({ watchlist_id: STARTUP, company_id: COMPANY, added_company: false });
    await undoDiscoveredCompany(deps(tables), change.undo);
    expect(tables['job_search.companies']).toHaveLength(1);
  });

  it('keeps a company that a role has come to hang on', async () => {
    const tables = find();
    const change = await made('add_discovered_company', tables, { name: 'Tiny Labs' });
    const company = tables['job_search.companies'][0];
    tables['job_search.roles'] = [{ id: RESUME, user_id: ME, company_id: company.id }];
    expect(await undoDiscoveredCompany(deps(tables), change.undo)).toEqual({ ok: true, restored: 1 });
    expect(tables['job_search.companies']).toHaveLength(1);
  });

  it('refuses one already added, and a name Find does not show', async () => {
    const tables = find();
    tables['job_search.watchlist_startups'][0].company_id = COMPANY;
    expect(await refused('add_discovered_company', tables, { name: 'Tiny Labs' })).toMatch(/in their companies already/);
    expect(await refused('add_discovered_company', find(), { name: 'Huge Labs' })).toMatch(/No startup on Find/);
  });
});
