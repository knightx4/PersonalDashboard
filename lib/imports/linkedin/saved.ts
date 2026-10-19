import type { LinkedInArchive } from '@/lib/linkedin/archive';
import { companyNameKey } from '@/lib/jobs/companies/same-company';
import { companyKey as watchlistKey } from '@/lib/jobs/suggest/payload';
import { slugify } from '@/lib/jobs/slug';
import { ref } from '../engine';
import type { ImportMapper, MappedRecord, MatchSkip } from '../types';
import { linkedInApplications, matchCompanies } from './applications';
import { exportDay, recentSavedJobs, savedJobSkip } from './saved-window';

// What the person saved, followed and set as preferences on LinkedIn
// (plan #2432.6). Three kinds, after the applications' ones:
//
//   leads        a recent saved job (saved-window.ts) not applied to becomes
//                an application at status lead, on the role linkedInRoles
//                made or joined for it. When that role already has an
//                application, the lead joins it and adds nothing.
//   watchlist    a followed company the person does not track goes on the
//                startup watchlist with source linkedin. One they track is
//                linked by linkedInCompanies and skipped here.
//   preferences  Job Seeker Preferences and the saved alerts fill the Jobs
//                profile's target titles, home location and workplace
//                preferences, only where those are empty: the profile is
//                joined, never added, and a join fills only empty columns.
//
// Status is never written: a lead is the column's default, and the status
// trigger owns it after that.

const SOURCE = 'linkedin';

// ── leads ───────────────────────────────────────────────────────────────────

export const linkedInSavedLeads: ImportMapper<LinkedInArchive> = {
  kind: 'leads',
  table: 'job_search.applications',
  columns: { role_id: 'uuid', source: 'text' },
  records(archive) {
    const day = exportDay(archive);
    const applied = new Set(archive.applications.map((a) => a.key));
    const recent = new Set(recentSavedJobs(archive).map((s) => s.key));
    return archive.savedJobs.map((s): MappedRecord => {
      if (applied.has(s.key)) return { key: s.key, skip: 'You applied to it; it comes in with your applications.' };
      if (!recent.has(s.key)) return { key: s.key, skip: savedJobSkip(s, day) ?? 'It is not a recent saved job.' };
      return { key: s.key, values: { role_id: ref('roles', s.key), source: SOURCE } };
    });
  },
  // The role's live (or latest) application, as the applications mapper joins one.
  match: (pending, store) => linkedInApplications.match!(pending, store),
};

// ── watchlist ───────────────────────────────────────────────────────────────

export const FOLLOW_REASON = 'You follow it on LinkedIn.';

export const linkedInFollowedStartups: ImportMapper<LinkedInArchive> = {
  kind: 'watchlist',
  table: 'job_search.watchlist_startups',
  columns: { name: 'text', name_key: 'text', source: 'text', reason: 'text' },
  records(archive) {
    // A company the export applies to or saved a recent job at is a companies
    // row in this same import, so following it adds nothing here.
    const companies = new Set([
      ...archive.applications.map((a) => companyNameKey(a.companyName ?? '')),
      ...recentSavedJobs(archive).map((s) => companyNameKey(s.companyName ?? '')),
    ]);
    return archive.companyFollows.map((f): MappedRecord => {
      const name = f.organization.trim();
      const key = watchlistKey(name);
      if (!key) return { key: f.key, skip: 'Its name has no letters or digits to file it by.' };
      if (companies.has(companyNameKey(name))) {
        return { key: f.key, skip: 'It is one of the companies this import adds or links.' };
      }
      return { key: f.key, values: { name, name_key: key, source: SOURCE, reason: FOLLOW_REASON } };
    });
  },
  async match(pending, store) {
    const out = new Map<string, string | MatchSkip>();
    const tracked = await matchCompanies(
      pending.map((p) => ({ key: p.key, name: String(p.values.name), slug: slugify(String(p.values.name)) })),
      store,
    );
    for (const key of tracked.keys()) out.set(key, { skip: 'It is one of your companies, and is linked there.' });
    const onList = await store.rowsWhere(
      'job_search.watchlist_startups',
      ['name_key'],
      'name_key',
      pending.filter((p) => !tracked.has(p.key)).map((p) => p.values.name_key),
    );
    const byNameKey = new Map(onList.map((r) => [String(r.name_key), String(r.id)]));
    for (const p of pending) {
      const id = !tracked.has(p.key) ? byNameKey.get(String(p.values.name_key)) : undefined;
      if (id) out.set(p.key, id);
    }
    return out;
  },
};

// ── preferences ─────────────────────────────────────────────────────────────

export type Workplace = 'remote' | 'hybrid' | 'on_site';

const WORKPLACE_ORDER: Workplace[] = ['remote', 'hybrid', 'on_site'];

/** The workplace a word or phrase names, if it names one. */
function workplaceOf(text: string): Workplace | null {
  const t = text.trim().toLowerCase();
  if (/^remote\b|\bremote$/.test(t)) return 'remote';
  if (/^hybrid\b|\bhybrid$/.test(t)) return 'hybrid';
  if (/^on[\s-]?site\b|\bon[\s-]?site$|^in[\s-]?office$/.test(t)) return 'on_site';
  return null;
}

/** LinkedIn's list cells: "a | b", or "a; b". */
function listOf(cell: string | null | undefined): string[] {
  return (cell ?? '')
    .split(/\s*[|;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The key=value pairs of an alert's parameters ("keywords=…&location=…"), keys lower-cased. */
export function alertParameters(parameters: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (parameters ?? '').split(/[&;\n]/)) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim().toLowerCase();
    let value = part.slice(at + 1).trim();
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      // Not encoded; keep it as written.
    }
    if (key && value && !out.has(key)) out.set(key, value);
  }
  return out;
}

/** LinkedIn's f_WT codes: 1 on-site, 2 remote, 3 hybrid. */
const WT_CODES: Record<string, Workplace> = { '1': 'on_site', '2': 'remote', '3': 'hybrid' };

export interface LinkedInPreferences {
  targetTitles: string[];
  homeLocation: string | null;
  workplace: Workplace[];
}

/** What the export says the person is looking for, from the preferences row first and the saved alerts after. */
export function linkedInPreferences(archive: LinkedInArchive): LinkedInPreferences {
  const titles: string[] = [];
  const places: string[] = [];
  const workplace = new Set<Workplace>();
  const addTitle = (t: string) => {
    if (t && !titles.some((x) => x.toLowerCase() === t.toLowerCase())) titles.push(t);
  };

  for (const p of archive.jobSeekerPreferences) {
    for (const t of listOf(p.jobTitles)) addTitle(t);
    for (const place of listOf(p.locations)) {
      const w = workplaceOf(place);
      if (w) workplace.add(w);
      else places.push(place);
    }
    for (const [header, value] of Object.entries(p.values)) {
      if (!/workplace|work location|location type|remote/i.test(header)) continue;
      for (const v of listOf(value.replace(/,/g, '|'))) {
        const w = workplaceOf(v);
        if (w) workplace.add(w);
      }
    }
  }

  // The alerts only fill what the preferences left out.
  const fromAlerts = titles.length === 0;
  for (const alert of archive.savedJobAlerts) {
    const params = alertParameters(alert.parameters);
    const keywords = params.get('keywords') ?? params.get('keyword') ?? params.get('title');
    if (fromAlerts && keywords) addTitle(keywords);
    const place = params.get('location') ?? params.get('locations');
    if (place && !workplaceOf(place)) places.push(place);
    for (const code of (params.get('f_wt') ?? '').split(/[,\s]+/)) {
      if (WT_CODES[code]) workplace.add(WT_CODES[code]);
    }
  }

  const home = places[0]?.slice(0, 200) ?? null;
  return {
    targetTitles: titles,
    homeLocation: home,
    workplace: WORKPLACE_ORDER.filter((w) => workplace.has(w)),
  };
}

export const PREFERENCES_KEY = 'job-seeker-preferences';

export const linkedInPreferencesMapper: ImportMapper<LinkedInArchive> = {
  kind: 'preferences',
  table: 'job_search.profiles',
  columns: { target_titles: 'text[]', home_location: 'text', workplace_preferences: 'text[]' },
  records(archive) {
    if (archive.jobSeekerPreferences.length === 0 && archive.savedJobAlerts.length === 0) return [];
    const prefs = linkedInPreferences(archive);
    if (prefs.targetTitles.length === 0 && !prefs.homeLocation && prefs.workplace.length === 0) {
      return [{ key: PREFERENCES_KEY, skip: 'The preferences in the export are empty.' }];
    }
    return [
      {
        key: PREFERENCES_KEY,
        // The arrays are never null: both columns are not null.
        values: {
          target_titles: prefs.targetTitles,
          home_location: prefs.homeLocation,
          workplace_preferences: prefs.workplace,
        },
        joinOnly: 'You have no Jobs profile to fill yet.',
      },
    ];
  },
  async match(pending, store) {
    // The person's one profile: pipeline_view is never null and is one of these.
    const [profile] = await store.rowsWhere('job_search.profiles', [], 'pipeline_view', ['board', 'list']);
    return new Map(profile ? pending.map((p) => [p.key, String(profile.id)]) : []);
  },
};

/** In the order the engine must run them, after the applications' mappers. */
export const LINKEDIN_SAVED_MAPPERS: ImportMapper<LinkedInArchive>[] = [
  linkedInSavedLeads,
  linkedInFollowedStartups,
  linkedInPreferencesMapper,
];
