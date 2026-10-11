/**
 * The Material tab's parts and addresses (plan #1592), kept out of the client
 * view so the server page and links elsewhere (a prep note's story, the
 * matcher's empty-bank hint) can build them too.
 */

/** The four parts of Material, in the order the switch shows them. */
export const MATERIAL_PARTS = [
  { id: 'answers', label: 'Answers' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'resumes', label: 'Resumes' },
  { id: 'voice', label: 'Voice' },
] as const;

export type MaterialPart = (typeof MATERIAL_PARTS)[number]['id'];

/** The question kinds the bank can be filtered to, in the rail's order. */
export const QUESTION_KINDS = [
  'motivation',
  'fit',
  'behavioral',
  'technical',
  'logistics',
  'demographic',
  'other',
] as const;

/** The address of one part, with the kind filter only where it applies. */
export function materialHref(part: MaterialPart, kind?: string | null): string {
  const params = new URLSearchParams();
  if (part !== 'answers') params.set('part', part);
  if (part === 'answers' && kind) params.set('kind', kind);
  const query = params.toString();
  return query ? `/jobs/material?${query}` : '/jobs/material';
}
