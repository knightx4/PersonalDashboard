import { execSync } from 'node:child_process';

/**
 * Every branch this checkout knows that carries a commit, local and remote.
 *
 * Asked only to say where a commit that is not on main actually is, when
 * `scripts/plan.ts` or `scripts/notes.ts` refuses a close. Git is the one that
 * can answer it: a commit a session never pushed does not exist at GitHub at
 * all, and that is the commonest way a step or a note ends up closed against
 * work nowhere but one machine. A sha this checkout has never seen makes git
 * exit non-zero, and no branch is the honest answer to that.
 */
export function branchesContaining(sha: string): string[] {
  // Straight into a shell, so nothing but a sha goes in. The format string is
  // quoted for the same shell: its brackets are syntax to bash, and unquoted
  // it makes git exit non-zero, which reads here as "on no branch".
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return [];
  try {
    const out = execSync(`git branch -a --contains ${sha} --format='%(refname:short)'`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== 'HEAD' && !line.startsWith('('));
  } catch {
    return [];
  }
}
