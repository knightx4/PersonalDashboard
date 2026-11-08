import { formatClock, whenDate } from '@/lib/core/when';

/**
 * Quick notes as sections of the one Quick note triage note (plan #3063).
 *
 * A quick note used to be a file of its own in the Inbox folder, and each one
 * reached Obsidian as a separate file. Now every quick note is a section of
 * Quick note triage: a heading with the day and time it was captured, a
 * marker line carrying its id and the moment it was captured, and its text.
 *
 *     ## 8 November 2026, 2:32 PM
 *     <!-- quick-note qn-mh8x2k1c-4f2a 2026-11-08T14:32:05.000Z -->
 *
 *     The text, as it was written.
 *
 * The marker is an HTML comment, so Obsidian's reading view hides it, and it
 * is what tells a quick note's heading from a heading inside its text: a
 * section runs from its heading to the next heading that has a marker under
 * it. Newest sections go at the foot.
 *
 * Pure, so the shapes are tested without a vault.
 */

/** The opening paragraph a new Quick note triage note gets. */
export const QUICK_NOTE_INTRO =
  'Your quick notes wait here, one section each, newest at the foot. Triage on the Vault page adds each one to a note or makes it a note of its own, and then takes its section out. You can edit them here as well.';

/** How the note opened while Dash rewrote it whole from the Inbox files (plan #1732). */
const OLD_INTRO = 'Dash keeps this note. It lists the quick notes waiting in your Inbox';

const MARK = /^<!--\s*quick-note\s+(qn-[a-z0-9-]+)(?:\s+(\S+))?\s*-->\s*$/;
const HEADING = /^##\s+\S/;

export type QuickSection = {
  /** The id in its marker, which stays with the section however it is edited. */
  id: string;
  /** When it was captured, as the marker keeps it; null when the marker has no time. */
  capturedAt: string | null;
  /** The heading line's text, after `## `. */
  heading: string;
  /** Its text, trimmed. */
  text: string;
};

function lines(body: string): string[] {
  return body.replace(/\r\n/g, '\n').split('\n');
}

/** Where each section starts: its heading's line, with a marker on the line after. */
function starts(all: readonly string[]): number[] {
  const found: number[] = [];
  for (let i = 0; i + 1 < all.length; i += 1) {
    if (HEADING.test(all[i]) && MARK.test(all[i + 1].trim())) found.push(i);
  }
  return found;
}

/** The quick notes in the note's body, in the order they sit. */
export function parseQuickSections(body: string): QuickSection[] {
  const all = lines(body);
  const at = starts(all);
  return at.map((start, index) => {
    const end = at[index + 1] ?? all.length;
    const mark = MARK.exec(all[start + 1].trim())!;
    const captured = mark[2] && !Number.isNaN(Date.parse(mark[2])) ? new Date(mark[2]).toISOString() : null;
    return {
      id: mark[1],
      capturedAt: captured,
      heading: all[start].replace(/^##\s+/, '').trim(),
      text: all.slice(start + 2, end).join('\n').trim(),
    };
  });
}

/** One section, by id; null when the note has none with it. */
export function findQuickSection(body: string, id: string): QuickSection | null {
  return parseQuickSections(body).find((section) => section.id === id) ?? null;
}

/** "8 November 2026, 2:32 PM", in the person's zone. */
export function quickSectionHeading(at: Date, timeZone: string): string {
  // A plain space before AM or PM: the heading is text in a file, read in any editor.
  return `${whenDate(at, { timeZone, month: 'long' })}, ${formatClock(at, { timeZone }).replace(/\s/g, ' ')}`;
}

/**
 * A new section's id: the moment in base 36 and four random characters, so
 * two notes captured in the same millisecond still differ. A quick note
 * folded in from its old file takes `fromNoteId` instead, so folding the
 * same file twice finds the section it already made.
 */
export function newQuickSectionId(at: Date, fromNoteId?: string): string {
  if (fromNoteId) return `qn-${fromNoteId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`;
  const random = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `qn-${at.getTime().toString(36)}-${random}`;
}

/** The section as written into the note. */
export function quickSectionBlock(section: { id: string; capturedAt: string; heading: string; text: string }): string {
  return `## ${section.heading}\n<!-- quick-note ${section.id} ${section.capturedAt} -->\n\n${section.text.replace(/\r\n/g, '\n').trim()}`;
}

/**
 * The body a change starts from. A note still in the old shape, the list
 * Dash rebuilt from the Inbox files, holds nothing of the person's own: the
 * files themselves are folded in, so the old list is dropped with them.
 */
function baseBody(body: string): string {
  return body.trimStart().startsWith(OLD_INTRO) ? '' : body;
}

/** True when the note is still the old list rebuilt from the Inbox files. */
export function isOldTriageList(body: string): boolean {
  return body.trimStart().startsWith(OLD_INTRO);
}

/** The body with these sections added at its foot, in the order given. */
export function withQuickSections(
  body: string,
  sections: readonly { id: string; capturedAt: string; heading: string; text: string }[],
): string {
  const head = baseBody(body).replace(/\s+$/, '') || QUICK_NOTE_INTRO;
  if (sections.length === 0) return `${head}\n`;
  return `${head}\n\n${sections.map(quickSectionBlock).join('\n\n')}\n`;
}

/** The body with one section taken out; null when it has no section with that id. */
export function withoutQuickSection(body: string, id: string): string | null {
  const all = lines(body);
  const at = starts(all);
  const index = at.findIndex((start) => MARK.exec(all[start + 1].trim())![1] === id);
  if (index === -1) return null;
  const head = all.slice(0, at[index]).join('\n').replace(/\s+$/, '');
  const tail = all.slice(at[index + 1] ?? all.length).join('\n').replace(/^\s+/, '');
  const joined = [head, tail].filter(Boolean).join('\n\n');
  return joined ? `${joined}\n` : '';
}

/**
 * A short fingerprint of a section's text (FNV-1a), so a page that showed it
 * can say which text it showed and a change since is refused. Not a security
 * measure: the text is the person's own either way.
 */
export function quickSectionFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  const normal = text.replace(/\r\n/g, '\n').trim();
  for (let i = 0; i < normal.length; i += 1) {
    hash ^= normal.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
