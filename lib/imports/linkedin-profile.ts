import type { LinkedInArchive } from '@/lib/linkedin/archive';
import { normal } from '@/lib/you/work-history';
import type { ColumnType, ImportMapper, PendingRecord } from './types';

// The profile half of the LinkedIn export, for You's Work & school tab
// (plan #2432.7).
//
// Positions go in you.work_history. A position whose employer and start month
// match a job already there joins that row rather than adding a second one,
// so the jobs read from the résumé or added by hand stay; the engine then
// fills only the row's empty columns, which puts LinkedIn's description in
// the note only where the note is empty. Every row the import writes or fills
// carries source 'linkedin', which a later read of the résumé keeps
// (planRead in lib/you/work-history.ts).
//
// Schools, certifications, honors, skills and courses go in
// you.profile_entries, one kind each. A course already on one of the person's
// transcripts (you.courses) is skipped, so the transcript's row is left alone.

const WORK = 'you.work_history';
const PROFILE = 'you.profile_entries';

/** A profile date as the tables keep it: "2016" or "2016-05", from the archive's "2016", "2016-05" or "2016-05-21". */
export function monthDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2]))?/.exec(value);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

function cut(value: string | null, max: number): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === '') return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Whether an end date can follow a start, by the tables' own check. */
function inOrder(started: string | null, ended: string | null): boolean {
  return !started || !ended || ended >= started || ended.slice(0, 4) === started.slice(0, 4);
}

/** Whether two stored dates name the same month, or the same year where one has no month. */
function sameStart(a: string, b: string): boolean {
  if (a.length === 4 || b.length === 4) return a.slice(0, 4) === b.slice(0, 4);
  return a === b;
}

const WORK_COLUMNS: Record<string, ColumnType> = {
  employer: 'text',
  title: 'text',
  place: 'text',
  started: 'text',
  ended: 'text',
  note: 'text',
  source: 'text',
};

export const positionsMapper: ImportMapper<LinkedInArchive> = {
  kind: 'positions',
  table: WORK,
  columns: WORK_COLUMNS,
  records: (archive) =>
    archive.positions.map((p) => {
      const employer = cut(p.companyName, 200);
      if (!employer) return { key: p.key, skip: 'It names no employer.' };
      const started = monthDate(p.startedOn);
      const ended = monthDate(p.finishedOn);
      if (!inOrder(started, ended)) return { key: p.key, skip: 'It ends before it starts.' };
      return {
        key: p.key,
        values: {
          employer,
          title: cut(p.title, 200),
          place: cut(p.location, 200),
          started,
          ended,
          note: cut(p.description, 4000),
          source: 'linkedin',
        },
      };
    }),
  // The job already kept with the same employer and start month, once each.
  async match(pending, store) {
    const starts = new Set<string>();
    for (const p of pending) {
      const started = p.values.started as string | null;
      if (started) {
        starts.add(started);
        starts.add(started.slice(0, 4));
      }
    }
    const rows = await store.rowsWhere(WORK, ['employer', 'started'], 'started', [...starts]);
    const out = new Map<string, string>();
    const taken = new Set<string>();
    for (const p of pending) {
      const started = p.values.started as string | null;
      if (!started) continue;
      const row = rows.find(
        (r) =>
          !taken.has(String(r.id)) &&
          normal(String(r.employer ?? '')) === normal(p.values.employer as string) &&
          typeof r.started === 'string' &&
          sameStart(r.started, started),
      );
      if (row) {
        out.set(p.key, String(row.id));
        taken.add(String(row.id));
      }
    }
    return out;
  },
};

const PROFILE_COLUMNS: Record<string, ColumnType> = {
  kind: 'text',
  name: 'text',
  detail: 'text',
  started: 'text',
  ended: 'text',
  description: 'text',
  activities: 'text',
  url: 'text',
  code: 'text',
  position: 'number',
};

type Entry = {
  name: string | null;
  detail?: string | null;
  started?: string | null;
  ended?: string | null;
  description?: string | null;
  activities?: string | null;
  url?: string | null;
  code?: string | null;
};

/** One profile entry's values, or why it is skipped. */
function entry(kind: string, key: string, position: number, e: Entry) {
  const name = cut(e.name, 300);
  if (!name) return { key, skip: 'It has no name.' };
  const started = monthDate(e.started ?? null);
  const ended = monthDate(e.ended ?? null);
  return {
    key,
    values: {
      kind,
      name,
      detail: cut(e.detail ?? null, 300),
      started,
      ended: inOrder(started, ended) ? ended : null,
      description: cut(e.description ?? null, 4000),
      activities: cut(e.activities ?? null, 2000),
      url: cut(e.url ?? null, 2000),
      code: cut(e.code ?? null, 200),
      position,
    },
  };
}

export const educationMapper: ImportMapper<LinkedInArchive> = {
  kind: 'education',
  table: PROFILE,
  columns: PROFILE_COLUMNS,
  records: (archive) =>
    archive.education.map((s, i) =>
      entry('school', s.key, i, {
        name: s.schoolName ?? s.degreeName,
        detail: s.schoolName ? s.degreeName : null,
        started: s.startDate,
        ended: s.endDate,
        description: s.notes,
        activities: s.activities,
      }),
    ),
};

export const certificationsMapper: ImportMapper<LinkedInArchive> = {
  kind: 'certifications',
  table: PROFILE,
  columns: PROFILE_COLUMNS,
  records: (archive) =>
    archive.certifications.map((c, i) =>
      entry('certification', c.key, i, {
        name: c.name,
        detail: c.authority,
        started: c.startedOn,
        ended: c.finishedOn,
        url: c.url,
        code: c.licenseNumber,
      }),
    ),
};

export const honorsMapper: ImportMapper<LinkedInArchive> = {
  kind: 'honors',
  table: PROFILE,
  columns: PROFILE_COLUMNS,
  records: (archive) =>
    archive.honors.map((h, i) =>
      entry('honor', h.key, i, { name: h.title, description: h.description, started: h.issuedOn }),
    ),
};

export const skillsMapper: ImportMapper<LinkedInArchive> = {
  kind: 'skills',
  table: PROFILE,
  columns: PROFILE_COLUMNS,
  records: (archive) => archive.skills.map((s, i) => entry('skill', s.key, i, { name: s.name })),
};

/** A course code as two are compared: "ECON 301", "econ301" and "ECON-301" are one. */
const codeKey = (value: unknown) => (typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '') : '');

export const coursesMapper: ImportMapper<LinkedInArchive> = {
  kind: 'courses',
  table: PROFILE,
  columns: PROFILE_COLUMNS,
  records: (archive) => archive.courses.map((c, i) => entry('course', c.key, i, { name: c.name, code: c.number })),
  // A course on a transcript is already kept, with its grade: the transcript's row is left alone.
  async exclude(pending: PendingRecord[], store) {
    const codes = new Set<string>();
    const names = new Set<string>();
    for (const p of pending) {
      const code = p.values.code as string | null;
      if (code) {
        codes.add(code);
        codes.add(code.replace(/\s+/g, ''));
        codes.add(code.replace(/^([A-Za-z]+)\s*-?\s*(\d)/, '$1 $2'));
      }
      names.add(p.values.name as string);
    }
    const onTranscript = [
      ...(await store.rowsWhere('you.courses', ['code', 'title'], 'code', [...codes])),
      ...(await store.rowsWhere('you.courses', ['code', 'title'], 'title', [...names])),
    ];
    const out = new Map<string, string>();
    for (const p of pending) {
      const code = codeKey(p.values.code);
      const name = normal(p.values.name as string);
      const found = onTranscript.some((r) => (code !== '' && codeKey(r.code) === code) || normal(String(r.title ?? '')) === name);
      if (found) out.set(p.key, 'It is already on one of your transcripts.');
    }
    return out;
  },
};

/** The profile's mappers, in the order LINKEDIN_MAPPERS runs them. */
export const LINKEDIN_PROFILE_MAPPERS: ImportMapper<LinkedInArchive>[] = [
  positionsMapper,
  educationMapper,
  certificationsMapper,
  honorsMapper,
  skillsMapper,
  coursesMapper,
];
