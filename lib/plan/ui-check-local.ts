import { execFileSync } from 'node:child_process';
import { importedBy, pagesUsing } from '../preview/importers';
import { surfacesForFiles } from '../preview/routes';
import { filesOfStep, type GitRunner } from './ui-check-guard';

/**
 * The guard's inputs read from this checkout (plan #1534): the files a step
 * changed and the gallery surfaces they serve. Used by `scripts/plan.ts done`
 * and `scripts/ui-guard.ts`; the rule itself is in `ui-check-guard.ts`.
 */

/** git in the current directory, with no shell between. */
export const localGit: GitRunner = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export function stepScreenInputs(step: number, commit: string): { files: string[]; surfaces: string[] } {
  const files = filesOfStep(step, commit, localGit);
  if (files.length === 0) return { files, surfaces: [] };
  const graph = importedBy(process.cwd());
  return { files, surfaces: surfacesForFiles(files, (file) => pagesUsing(file, graph)) };
}
