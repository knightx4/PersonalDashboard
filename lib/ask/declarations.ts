import { devAsk } from '@/lib/dev/ask-declaration';
import { goalsAsk } from '@/lib/goals/ask-declaration';
import { shoppingAsk } from '@/lib/inventory/ask-declaration';
import { jobsAsk } from '@/lib/jobs/ask-declaration';
import { learnAsk } from '@/lib/learn/ask-declaration';
import { newsAsk } from '@/lib/news/ask-declaration';
import { todoAsk } from '@/lib/todo/ask-declaration';
import { vaultAsk } from '@/lib/vault/ask-declaration';
import type { AskDeclaration } from './declaration';
import type { AskToolName } from './tools';

/**
 * Every workspace's declaration, gathered (lib/ask/declaration.ts). The
 * prompt reads this; a new workspace adds its file to the list and nothing
 * else.
 */
export const ASK_DECLARATIONS: readonly AskDeclaration[] = [
  vaultAsk,
  jobsAsk,
  shoppingAsk,
  todoAsk,
  goalsAsk,
  learnAsk,
  newsAsk,
  devAsk,
];

/** What to say when a tool found nothing, from whichever workspace declared it. */
export function emptyHint(tool: AskToolName): string | null {
  for (const declaration of ASK_DECLARATIONS) {
    const hint = declaration.whenEmpty?.[tool];
    if (hint) return hint;
  }
  return null;
}
