/**
 * The schools, certifications, honors, skills and courses from the person's
 * LinkedIn profile, on You's Work & school tab (plan #2432.7). One row of
 * you.profile_entries each; the import writes them
 * (lib/imports/linkedin-profile.ts) and the tab lists them by kind.
 */
import { EDUCATION_HREF } from '@/lib/you/education';

export const PROFILE_KINDS = ['school', 'certification', 'honor', 'skill', 'course'] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** One row of you.profile_entries. Which columns a kind uses is in the migration's header. */
export type ProfileEntry = {
  id: string;
  kind: ProfileKind;
  name: string;
  /** A school's degree, a certification's authority. */
  detail: string | null;
  started: string | null;
  ended: string | null;
  description: string | null;
  activities: string | null;
  url: string | null;
  /** A certification's license number, a course's number. */
  code: string | null;
  position: number;
};

/** The columns the tab reads. */
export const PROFILE_ENTRY_COLUMNS = 'id, kind, name, detail, started, ended, description, activities, url, code, position';

/** Where the import is run from. */
export const LINKEDIN_IMPORT_HREF = '/jobs/settings';

/** The anchor an entry's row carries on the Work & school tab. */
export function profileAnchor(id: string): string {
  return `profile-${id}`;
}

/** Where one entry opens: its row on the Work & school tab. */
export function profileHref(id: string): string {
  return `${EDUCATION_HREF}#${profileAnchor(id)}`;
}

export type ProfileLists = Record<ProfileKind, ProfileEntry[]>;

/**
 * The entries by kind, each list newest first where it has dates (schools,
 * certifications and honors) and in the export's order otherwise.
 */
export function groupProfile(entries: readonly ProfileEntry[]): ProfileLists {
  const lists: ProfileLists = { school: [], certification: [], honor: [], skill: [], course: [] };
  for (const entry of entries) lists[entry.kind]?.push(entry);
  const newest = (a: ProfileEntry, b: ProfileEntry) =>
    (b.started ?? b.ended ?? '').localeCompare(a.started ?? a.ended ?? '') || a.position - b.position;
  lists.school.sort(newest);
  lists.certification.sort(newest);
  lists.honor.sort(newest);
  lists.skill.sort((a, b) => a.position - b.position);
  lists.course.sort((a, b) => a.position - b.position);
  return lists;
}
