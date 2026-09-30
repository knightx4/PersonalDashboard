import type { ModuleId } from '@/lib/modules';
import type { AskToolName } from './tools';

/**
 * What a workspace tells Dash about itself.
 *
 * Each module writes one of these beside its own code (lib/vault/ask-declaration.ts
 * and the others), and lib/ask/declarations.ts gathers them. Dash's prompt is
 * built from the list, so a module changes how Dash understands it by editing
 * its own file, and the prompt has no sentence about any one workspace.
 * tests/ask-declarations.test.ts holds the list to lib/modules.ts: a workspace
 * without a declaration fails the gate.
 */
export type AskDeclaration = {
  module: ModuleId;
  /** One sentence: what the workspace is. */
  is: string;
  /** What it holds, one entry per kind of thing, in the person's terms. */
  holds: readonly string[];
  /** The tools that read it, best first. */
  readWith: readonly AskToolName[];
  /**
   * What to tell the model when one of these tools found nothing, by tool: the
   * other wordings or tools worth trying before it says it cannot see the
   * thing. Only the tools this workspace owns.
   */
  whenEmpty?: Partial<Record<AskToolName, string>>;
};

/** The list the prompt carries: one entry per workspace, in the order given. */
export function workspacesBlock(declarations: readonly AskDeclaration[]): string {
  const lines = declarations.map((d) => {
    const tools = d.readWith.length > 0 ? ` Read with ${d.readWith.join(', ')}.` : '';
    return `- ${moduleName(d.module)}: ${d.is} Holds ${d.holds.join('; ')}.${tools}`;
  });
  return lines.join('\n');
}

/** The workspace's name as the page shows it. */
function moduleName(id: ModuleId): string {
  return NAMES[id];
}

const NAMES: Record<ModuleId, string> = {
  shopping: 'Shopping',
  jobs: 'Job search',
  vault: 'Vault',
  todo: 'Todo',
  learn: 'Learn',
  news: 'News',
  goals: 'Goals',
  dev: 'Dev',
};

/** The names of workspaces that are switched off, for the line that says so. */
export function switchedOff(enabled: readonly ModuleId[], all: readonly ModuleId[]): string[] {
  return all.filter((id) => !enabled.includes(id)).map(moduleName);
}
