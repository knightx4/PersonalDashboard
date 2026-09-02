/**
 * Reading a repository out of whatever someone pasted.
 *
 * People paste what their browser or their git remote gave them, not the
 * canonical `owner/repo`. Accepting all three forms costs three patterns and
 * removes the most likely reason a first connection fails -- which matters
 * more than usual here, because connecting is a thing each person does exactly
 * once and has no practice at.
 */
export type RepoRef = { owner: string; repo: string };

const PATTERNS = [
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/,
];

export function parseRepoInput(raw: string): RepoRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const pattern of PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}
