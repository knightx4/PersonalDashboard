/**
 * The workspaces, named once.
 *
 * Not in `lib/core/account/settings.ts` with the rest of the account settings,
 * because that module is `server-only` and the workspace switcher is a client
 * component that has to know which workspaces exist. A list of four strings is
 * not worth a server boundary.
 */
export const MODULES = ['shopping', 'jobs', 'vault', 'todo'] as const;

export type ModuleId = (typeof MODULES)[number];

export function isModuleId(value: string): value is ModuleId {
  return (MODULES as readonly string[]).includes(value);
}
