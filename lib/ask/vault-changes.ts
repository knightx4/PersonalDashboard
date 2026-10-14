import type { LearnChangeInput } from './learn-changes';

/**
 * The Vault changes Dash makes straight away (plan #1894.9.3), and keeping a
 * transcript or correcting a course on Work & school, which came from the
 * Vault.
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/vault-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The write tools, by name, which is the kind each change is kept under. */
export const VAULT_CHANGE_KINDS = [
  'write_vault_note',
  'edit_vault_note',
  'rename_vault_note',
  'file_quick_note',
  'rename_theme',
  'rename_maya_question',
  'change_course',
  'save_transcript',
] as const;

export type VaultChangeKind = (typeof VAULT_CHANGE_KINDS)[number];

/**
 * The kinds that change a note's file in the notes repository, so their Undo
 * is another commit (lib/vault/notes/undo.ts), not the generic rule.
 */
export const VAULT_FILE_KINDS: readonly VaultChangeKind[] = [
  'write_vault_note',
  'edit_vault_note',
  'rename_vault_note',
  'file_quick_note',
];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type VaultChangeInput = LearnChangeInput;

export function isVaultChangeKind(kind: string): kind is VaultChangeKind {
  return (VAULT_CHANGE_KINDS as readonly string[]).includes(kind);
}

/** Whether a change's Undo takes a commit back. */
export function isVaultFileKind(kind: string): boolean {
  return (VAULT_FILE_KINDS as readonly string[]).includes(kind);
}
