/**
 * Names this app's repository for the CLI scripts, from the checkout's origin.
 *
 * lib/plan/github.ts reads the repository from APP_REPOSITORY, Vercel's
 * variables or GITHUB_REPOSITORY, once, when it loads. A cloud session has
 * none of them, so a script must set APP_REPOSITORY before that module is
 * evaluated: import this file first, above every import that reaches it.
 * A value already set is left alone, and a checkout git cannot read leaves
 * it unset, as before.
 */
import { execSync } from 'node:child_process';
import { repositoryFromRemote } from '../lib/plan/remote';

if (
  !process.env.APP_REPOSITORY?.trim() &&
  !(process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG) &&
  !process.env.GITHUB_REPOSITORY?.trim()
) {
  try {
    const url = execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const named = repositoryFromRemote(url);
    if (named) process.env.APP_REPOSITORY = named;
  } catch {
    // No git, or no origin: GitHub reads fail with their own sentence.
  }
}
