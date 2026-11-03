/**
 * "owner/name" from a git remote URL, or null when it names no repository.
 *
 * The CLI scripts run in a checkout, where none of the variables `appRepo`
 * (lib/plan/github.ts) reads is set: a cloud session has no Vercel deploy and
 * no Actions run. Left there, the repository was empty, every compare went to
 * `/repos//…`, GitHub said 404, and closing a step blamed GITHUB_READ_TOKEN
 * for a week while the token was fine. The checkout's own origin names the
 * repository, so scripts/app-repository.ts reads it into APP_REPOSITORY
 * before lib/plan/github.ts loads.
 *
 * This file imports nothing, so that script can use it without loading
 * github.ts early. Takes https, ssh and proxied remotes alike: the last two
 * segments of the path.
 */
export function repositoryFromRemote(url: string): string | null {
  const match = /[/:]([^/:@]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}
