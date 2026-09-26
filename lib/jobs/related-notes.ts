/**
 * The words a job pursuit is matched against your vault notes on (plan #1114,
 * under #1110): the company, the role, and the first section of the job
 * description. The role page passes this to relatedNotes
 * (lib/vault/notes/related.ts), which embeds it once and keeps the vector by
 * the text's hash.
 *
 * Only fields that describe what the pursuit is about go in, so a change of
 * status, a note or a new interview does not change the text and costs no new
 * embedding. Renaming the role or the company does, once.
 *
 * The first section rather than the whole description because the opening is
 * where a posting says who the company is and what the role does, and the rest
 * is requirements and benefits boilerplate that every posting shares.
 *
 * A pursuit with no description gets no text, and so no notes. Checked against
 * the live vault in September 2026, a company and a role alone are too few
 * words to match on: "Portage Point Partners, Associate, Transaction Advisory
 * Services" found the application note at 0.63 but a note about meeting a
 * consultant at 0.64, and "Google" found a note on a solitaire game at 0.61.
 * No threshold kept the right note and dropped the wrong ones. With the
 * opening of the description the same pursuits found their own application
 * notes at 0.63 to 0.71. Most pursuits then (260 of 283) had no description,
 * so most show no notes until one is fetched.
 */

/**
 * The title ingestion gives a role no message could name. It says nothing
 * about the subject, and "email" would pull in notes about email, so it is
 * left out. The same string as PLACEHOLDER_ROLE_TITLE in
 * lib/jobs/inbox/ingest-messages.ts, which the test holds it to; not imported
 * from there because that file brings the ingestion pipeline with it.
 */
export const PLACEHOLDER_TITLE = 'Role from email';

/** Paragraphs shorter than this are headings ("About the job", "Who We Are:"). */
const HEADING_MAX_CHARS = 40;
/** Enough of the opening to say what the company and the role are. */
const FIRST_SECTION_MIN_CHARS = 300;
/** A description with no paragraph breaks is cut here. */
export const FIRST_SECTION_MAX_CHARS = 1_200;

/**
 * The opening of a job description: its paragraphs from the top, headings
 * skipped, until there is enough to say what the company and the role are.
 */
export function firstSection(jdText: string | null | undefined): string {
  if (!jdText) return '';
  const paragraphs = jdText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= HEADING_MAX_CHARS);
  let out = '';
  for (const paragraph of paragraphs) {
    out = out ? `${out}\n${paragraph}` : paragraph;
    if (out.length >= FIRST_SECTION_MIN_CHARS) break;
  }
  return out.slice(0, FIRST_SECTION_MAX_CHARS).trim();
}

/** The text to match, or '' (no lookup, no notes) when there is no description. */
export function pursuitMatchText(pursuit: {
  company: string;
  title: string | null;
  jdText: string | null;
}): string {
  const opening = firstSection(pursuit.jdText);
  if (!opening) return '';
  const title = pursuit.title?.trim() ?? '';
  const named = title.toLowerCase() === PLACEHOLDER_TITLE.toLowerCase() ? '' : title;
  return [pursuit.company.trim(), named, opening].filter(Boolean).join('\n');
}
