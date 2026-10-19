import type { JobApplicationRecord, LinkedInArchive } from '@/lib/linkedin/archive';
import { companyNameKey, findSameCompany, type CompanyIdentity } from '@/lib/jobs/companies/same-company';
import { questionFingerprint, normalizeQuestion } from '@/lib/jobs/fingerprint';
import { choosePursuitFor, pursuitsFromRoles } from '@/lib/jobs/inbox/pursuits';
import { slugify } from '@/lib/jobs/slug';
import { ref } from '../engine';
import type { ImportMapper, ImportStore, MappedRecord, PendingRecord } from '../types';

// LinkedIn's Easy Apply history into Jobs (plan #2432.4): the companies and
// roles applied to, one submitted application each with the date it went in,
// the resume it carried and the answers it gave, and the question bank.
//
// The kinds run in this order, each referring to rows of the ones before:
//
//   companies     one per employer, keyed by companyNameKey, joined to the
//                 person's company by slug or by findSameCompany, the same
//                 two questions findExistingCompany asks.
//   roles         one per application, keyed like it. Joined to a role whose
//                 ats_job_id or jd_url carries the LinkedIn job id, else to
//                 the pursuit choosePursuitFor picks at that company.
//   resumes       one resume version per resume name, joined by label, with
//                 the text of the Private_identity_asset of the same name.
//   applications  submitted, with submitted_at at the LinkedIn date. A
//                 joined role's live (or latest) application is joined.
//   applied       a submitted event (source system) on each application, so
//                 the status trigger works out where it stands. An existing
//                 submitted event is joined rather than doubled.
//   questions     one per questionFingerprint, from the applications'
//                 answers and the saved screening responses. The saved
//                 answer is the canonical one; a question the person already
//                 has gains it only when it has none, as a join fills only
//                 empty columns.
//   answers       each question an application asked, its answer marked
//                 submitted.
//
// Status, closed_at and the other columns the status trigger rewrites are
// never written: writing one would make the row look edited on the next run.

const SOURCE = 'linkedin';

// The store has no "every row" read, so a mapper that must compare against all
// of the person's companies, roles or resumes asks for the rows whose not-null
// enum column takes any of its values.
async function everyRow(
  store: ImportStore,
  table: string,
  columns: string[],
  column: string,
  values: unknown[],
): Promise<Record<string, unknown>[]> {
  return store.rowsWhere(table, columns, column, values);
}

/** rowsWhere in slices, so a long list of ids stays inside a URL. */
async function rowsIn(
  store: ImportStore,
  table: string,
  columns: string[],
  column: string,
  values: unknown[],
): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(values)];
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    out.push(...(await store.rowsWhere(table, columns, column, unique.slice(i, i + 100))));
  }
  return out;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** The LinkedIn job id in a posting's URL: /jobs/view/<slug->id or ?currentJobId=id. */
export function linkedInJobId(url: string | null | undefined): string | null {
  if (!url || !/linkedin\.com/i.test(url)) return null;
  const view = /\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i.exec(url);
  if (view) return view[1];
  const current = /[?&]currentJobId=(\d{6,})/i.exec(url);
  return current ? current[1] : null;
}

/** The record key of the company an application names, or null when it names none. */
function companyKey(name: string | null): string | null {
  const trimmed = name?.trim();
  return trimmed ? companyNameKey(trimmed) : null;
}

/** A resume's name reduced for comparing: no extension, case or punctuation. */
export function resumeNameKey(name: string): string {
  return name
    .replace(/\.(pdf|docx?|txt|rtf|odt)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The applications that can become a role: those naming a company and a title. */
function usable(a: JobApplicationRecord): boolean {
  return !!companyKey(a.companyName) && !!a.jobTitle?.trim();
}

// ── companies ───────────────────────────────────────────────────────────────

export const linkedInCompanies: ImportMapper<LinkedInArchive> = {
  kind: 'companies',
  table: 'job_search.companies',
  columns: { name: 'text', slug: 'text' },
  records(archive) {
    const out: MappedRecord[] = [];
    const seen = new Set<string>();
    for (const a of archive.applications) {
      const key = companyKey(a.companyName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const name = a.companyName!.trim();
      out.push({ key, values: { name, slug: slugify(name) } });
    }
    return out;
  },
  async match(pending, store) {
    // Every company the person has: priority is never null and takes one of these.
    const mine = (await everyRow(
      store,
      'job_search.companies',
      ['name', 'slug', 'domains', 'website', 'ats_type', 'ats_board_token'],
      'priority',
      ['target', 'interested', 'backup', 'passed'],
    )) as unknown as (CompanyIdentity & { id: string; slug: string })[];
    const bySlug = new Map(mine.map((c) => [c.slug, c.id]));
    const out = new Map<string, string>();
    for (const p of pending) {
      const name = String(p.values.name);
      const id = bySlug.get(String(p.values.slug)) ?? findSameCompany({ name, domains: [] }, mine)?.company.id;
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

// ── roles ───────────────────────────────────────────────────────────────────

export const linkedInRoles: ImportMapper<LinkedInArchive> = {
  kind: 'roles',
  table: 'job_search.roles',
  columns: { company_id: 'uuid', title: 'text', jd_url: 'text', ats_job_id: 'text', source: 'text' },
  records(archive) {
    return archive.applications.map((a): MappedRecord => {
      if (!usable(a)) return { key: a.key, skip: 'It names no company or no job title.' };
      return {
        key: a.key,
        values: {
          company_id: ref('companies', companyKey(a.companyName)!),
          title: a.jobTitle!.trim(),
          jd_url: a.jobUrl,
          ats_job_id: a.jobId ?? linkedInJobId(a.jobUrl),
          source: SOURCE,
        },
      };
    });
  },
  async match(pending, store) {
    const roles = await everyRow(
      store,
      'job_search.roles',
      ['company_id', 'title', 'ats_job_id', 'jd_url', 'created_at'],
      'posting_status',
      ['open', 'closed', 'unknown'],
    );
    const byJobId = new Map<string, string>();
    for (const r of roles) {
      for (const id of [str(r.ats_job_id), linkedInJobId(str(r.jd_url))]) {
        if (id && !byJobId.has(id)) byJobId.set(id, String(r.id));
      }
    }

    // The pursuits at each company the pending roles name, for choosePursuitFor.
    const companies = new Set(pending.map((p) => String(p.values.company_id)));
    const atCompanies = roles.filter((r) => companies.has(String(r.company_id)));
    const applications = await rowsIn(
      store,
      'job_search.applications',
      ['role_id', 'status', 'attempt', 'closed_at', 'created_at'],
      'role_id',
      atCompanies.map((r) => r.id),
    );
    const appRole = new Map(applications.map((a) => [String(a.id), String(a.role_id)]));
    const pursuitsAt = (companyId: string) =>
      pursuitsFromRoles(
        atCompanies
          .filter((r) => String(r.company_id) === companyId)
          .map((r) => ({
            id: r.id,
            title: r.title,
            created_at: r.created_at,
            applications: applications.filter((a) => a.role_id === r.id),
          })),
      );

    const out = new Map<string, string>();
    for (const p of pending) {
      const jobId = str(p.values.ats_job_id);
      const byId = jobId ? byJobId.get(jobId) : undefined;
      if (byId) {
        out.set(p.key, byId);
        continue;
      }
      const choice = choosePursuitFor(pursuitsAt(String(p.values.company_id)), {
        title: String(p.values.title),
        // The job id was looked for above, across every company; an ATS id on
        // a role here is another board's and says nothing against a title.
        atsJobId: null,
        receivedAt: null,
        startsPursuit: true,
      });
      if (choice.kind === 'rename') out.set(p.key, choice.roleId);
      else if (choice.kind === 'adopt') {
        const roleId = appRole.get(choice.applicationId);
        if (roleId) out.set(p.key, roleId);
      }
    }
    return out;
  },
};

// ── resumes ─────────────────────────────────────────────────────────────────

export const linkedInResumes: ImportMapper<LinkedInArchive> = {
  kind: 'resumes',
  table: 'job_search.resume_versions',
  columns: { label: 'text', text_content: 'text' },
  records(archive) {
    const texts = new Map<string, string>();
    for (const asset of archive.identityAssets) {
      const k = resumeNameKey(asset.name);
      if (asset.text && k && !texts.has(k)) texts.set(k, asset.text);
    }
    const out: MappedRecord[] = [];
    const seen = new Set<string>();
    for (const a of archive.applications) {
      const label = a.resumeName?.trim();
      if (!label) continue;
      const key = resumeNameKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, values: { label, text_content: texts.get(key) ?? null } });
    }
    return out;
  },
  async match(pending, store) {
    // Every resume version the person has: is_default is never null.
    const mine = await everyRow(store, 'job_search.resume_versions', ['label'], 'is_default', [true, false]);
    const byName = new Map(mine.map((r) => [resumeNameKey(String(r.label ?? '')), String(r.id)]));
    const out = new Map<string, string>();
    for (const p of pending) {
      const id = byName.get(p.key);
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

// ── applications ────────────────────────────────────────────────────────────

/** The resume key an application refers to, or null. */
function resumeKey(a: JobApplicationRecord): string | null {
  const label = a.resumeName?.trim();
  return label ? resumeNameKey(label) || null : null;
}

export const linkedInApplications: ImportMapper<LinkedInArchive> = {
  kind: 'applications',
  table: 'job_search.applications',
  columns: { role_id: 'uuid', submitted_at: 'timestamptz', source: 'text', resume_version_id: 'uuid' },
  records(archive) {
    return archive.applications.map((a): MappedRecord => {
      if (!usable(a)) return { key: a.key, skip: 'It names no company or no job title.' };
      const resume = resumeKey(a);
      return {
        key: a.key,
        values: {
          role_id: ref('roles', a.key),
          submitted_at: a.appliedAt,
          source: SOURCE,
          resume_version_id: resume ? ref('resumes', resume) : null,
        },
      };
    });
  },
  async match(pending, store) {
    // A role the import joined may already have its application: the live
    // one, or the latest attempt when all have closed.
    const apps = await rowsIn(
      store,
      'job_search.applications',
      ['role_id', 'status', 'attempt', 'closed_at', 'created_at'],
      'role_id',
      pending.map((p) => p.values.role_id),
    );
    if (apps.length === 0) return new Map();
    const chosen = new Map(
      pursuitsFromRoles(
        [...new Set(apps.map((a) => String(a.role_id)))].map((id) => ({
          id,
          title: '',
          applications: apps.filter((a) => String(a.role_id) === id),
        })),
      ).map((p) => [p.roleId, p.applicationId]),
    );
    const out = new Map<string, string>();
    for (const p of pending) {
      const id = chosen.get(String(p.values.role_id));
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

// ── the submitted event ─────────────────────────────────────────────────────

export const linkedInAppliedEvents: ImportMapper<LinkedInArchive> = {
  kind: 'applied',
  table: 'job_search.application_events',
  columns: { application_id: 'uuid', kind: 'text', occurred_at: 'timestamptz', source: 'text', summary: 'text' },
  records(archive) {
    return archive.applications.map((a): MappedRecord => {
      if (!usable(a)) return { key: a.key, skip: 'It names no company or no job title.' };
      if (!a.appliedAt) return { key: a.key, skip: 'It has no application date.' };
      return {
        key: a.key,
        values: {
          application_id: ref('applications', a.key),
          kind: 'submitted',
          occurred_at: a.appliedAt,
          source: 'system',
          summary: 'Applied on LinkedIn',
        },
      };
    });
  },
  async match(pending, store) {
    const events = await rowsIn(
      store,
      'job_search.application_events',
      ['application_id', 'kind', 'occurred_at'],
      'application_id',
      pending.map((p) => p.values.application_id),
    );
    const first = new Map<string, { id: string; at: string }>();
    for (const e of events) {
      if (e.kind !== 'submitted') continue;
      const app = String(e.application_id);
      const at = String(e.occurred_at ?? '');
      const had = first.get(app);
      if (!had || at < had.at) first.set(app, { id: String(e.id), at });
    }
    const out = new Map<string, string>();
    for (const p of pending) {
      const hit = first.get(String(p.values.application_id));
      if (hit) out.set(p.key, hit.id);
    }
    return out;
  },
};

// ── questions and answers ───────────────────────────────────────────────────

/** The fingerprint of a question, or null when nothing of it survives normalising. */
function fingerprintOf(text: string): string | null {
  return normalizeQuestion(text) ? questionFingerprint(text) : null;
}

export const linkedInQuestions: ImportMapper<LinkedInArchive> = {
  kind: 'questions',
  table: 'job_search.questions',
  columns: { text: 'text', fingerprint: 'text', canonical_answer: 'text' },
  records(archive) {
    const text = new Map<string, string>();
    const saved = new Map<string, string>();
    for (const s of archive.screeningAnswers) {
      const fp = fingerprintOf(s.question);
      if (!fp) continue;
      if (!text.has(fp)) text.set(fp, s.question.trim());
      if (s.answer?.trim() && !saved.has(fp)) saved.set(fp, s.answer.trim());
    }
    for (const a of archive.applications) {
      for (const qa of a.answers) {
        const fp = fingerprintOf(qa.question);
        if (fp && !text.has(fp)) text.set(fp, qa.question.trim());
      }
    }
    return [...text].map(([fp, question]) => ({
      key: fp,
      values: { text: question, fingerprint: fp, canonical_answer: saved.get(fp) ?? null },
    }));
  },
  async match(pending, store) {
    const mine = await rowsIn(store, 'job_search.questions', ['fingerprint'], 'fingerprint', pending.map((p) => p.key));
    return new Map(mine.map((q) => [String(q.fingerprint), String(q.id)]));
  },
};

export const linkedInAnswers: ImportMapper<LinkedInArchive> = {
  kind: 'answers',
  table: 'job_search.application_answers',
  columns: { application_id: 'uuid', question_id: 'uuid', answer: 'text', status: 'text' },
  records(archive) {
    const out: MappedRecord[] = [];
    for (const a of archive.applications) {
      if (!usable(a)) continue;
      const asked = new Set<string>();
      for (const qa of a.answers) {
        const fp = fingerprintOf(qa.question);
        // One answer per question per application: the first the export gives.
        if (!fp || asked.has(fp)) continue;
        asked.add(fp);
        out.push({
          key: `${a.key}:${fp}`,
          values: {
            application_id: ref('applications', a.key),
            question_id: ref('questions', fp),
            answer: qa.answer.trim() || null,
            status: 'submitted',
          },
        });
      }
    }
    return out;
  },
  async match(pending: PendingRecord[], store) {
    const mine = await rowsIn(
      store,
      'job_search.application_answers',
      ['application_id', 'question_id'],
      'application_id',
      pending.map((p) => p.values.application_id),
    );
    const byPair = new Map(mine.map((r) => [`${r.application_id}:${r.question_id}`, String(r.id)]));
    const out = new Map<string, string>();
    for (const p of pending) {
      const id = byPair.get(`${p.values.application_id}:${p.values.question_id}`);
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

/** In the order the engine must run them: each after the kinds it refers to. */
export const LINKEDIN_APPLICATION_MAPPERS: ImportMapper<LinkedInArchive>[] = [
  linkedInCompanies,
  linkedInRoles,
  linkedInResumes,
  linkedInApplications,
  linkedInAppliedEvents,
  linkedInQuestions,
  linkedInAnswers,
];
