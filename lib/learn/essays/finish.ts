/**
 * Finishing an essay (plan #1873; docs/LEARN-ESSAYS-SPEC.md, "Finishing and
 * publishing").
 *
 * Finish names the claims the essay argues, logs the essay in the learning
 * log with them, offers a short note for each claim the vault does not have,
 * and offers to add the essay to the Jobs evidence bank. This file holds the
 * parts that need no database: what the model is shown, how its reply is
 * read, and the text of the notes, the log entry and the evidence item.
 */

/** Most claims one essay is logged with: the learning log keeps twelve ideas an entry. */
export const MAX_CLAIMS = 8;

/** Longest claim name and claim, as the log and a note's heading hold them. */
const NAME_MAX = 80;
const CLAIM_MAX = 400;

/** How much of the essay the model is shown. A 2,000-word essay is about 14,000 characters. */
export const CLAIMS_TEXT_MAX = 24_000;

export type EssayClaim = { name: string; claim: string };

/** A claim, and the vault note it already looks to be in, when there is one. */
export type OfferedClaim = EssayClaim & { existing: { title: string; href: string } | null };

/**
 * The words the claims are read from: the essay without its footnote
 * definitions, which are quotations from other people's pages, and without
 * the markers that point at them.
 */
export function claimsText(draft: string): string {
  return draft
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\[\^[^\]]+\]:/.test(line))
    .join('\n')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CLAIMS_TEXT_MAX);
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The claims in the model's reply: a JSON object with a `claims` array, or
 * the array alone, in a code fence or not. Entries without both a name and a
 * claim are dropped, as are repeated names; at most MAX_CLAIMS are kept.
 */
export function readClaims(reply: string): EssayClaim[] {
  const text = reply
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { claims?: unknown }).claims)
      ? (parsed as { claims: unknown[] }).claims
      : [];
  const seen = new Set<string>();
  const claims: EssayClaim[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const name = clean((entry as { name?: unknown }).name, NAME_MAX).replace(/^#+\s*/, '');
    const claim = clean((entry as { claim?: unknown }).claim, CLAIM_MAX);
    const key = name.toLowerCase();
    if (!name || !claim || seen.has(key)) continue;
    seen.add(key);
    claims.push({ name, claim });
    if (claims.length === MAX_CLAIMS) break;
  }
  return claims;
}

/**
 * The note offered for a claim: a heading with the claim's name, the claim as
 * one or two sentences, and a link back to the essay. It goes in `Inbox/`
 * under the heading's text.
 */
export function claimNote(claim: EssayClaim, essayTitle: string): string {
  const from = essayTitle.replace(/[[\]|#^]/g, ' ').replace(/\s+/g, ' ').trim();
  const lines = [`# ${claim.name}`, '', claim.claim];
  if (from) lines.push('', `Argued in [[${from}]].`);
  return `${lines.join('\n')}\n`;
}

/** What the learning log keeps for a finished essay. */
export function logEntry(input: { title: string; claim: string; claims: readonly EssayClaim[] }): {
  topic: string;
  question: string | null;
  summary: string;
} {
  const lead = input.claim.trim();
  const argued = input.claims.map((claim) => claim.claim).join(' ');
  const summary = lead ? `Wrote an essay arguing: ${lead}` : `Wrote an essay, "${input.title}".`;
  const count = `${input.claims.length} ${input.claims.length === 1 ? 'claim' : 'claims'}`;
  return {
    topic: clean(input.title, 200) || 'Untitled essay',
    question: null,
    summary: clean(argued ? `${summary} It makes ${count}: ${argued}` : summary, 4_000),
  };
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

/** The evidence-bank item for an essay: a handle, the story, and where to read it. */
export function essayEvidence(input: {
  id: string;
  title: string;
  claim: string;
  claims: readonly EssayClaim[];
  finishedOn: string;
}): { title: string; body: string; context: string } {
  const points = input.claims.map((claim) => `- ${claim.name}: ${claim.claim}`).join('\n');
  const lead = input.claim.trim()
    ? `I wrote an essay arguing that ${lowerFirst(input.claim.trim())}`
    : `I wrote an essay, "${input.title}".`;
  const body = [lead, points && `The points it makes:\n${points}`, `The essay is at /learn/e/${input.id}.`]
    .filter(Boolean)
    .join('\n\n');
  return {
    title: clean(`Essay: ${input.title}`, 160),
    body,
    context: clean(`An essay I finished on ${input.finishedOn}.`, 400),
  };
}
