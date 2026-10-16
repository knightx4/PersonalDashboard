import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the Vault pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const vaultActions: ModuleActions = {
  'app/vault/actions.ts': {
    dismissNoteConnection: none('theirs'),
    newVaultNote: tool('write_vault_note'),
    addQuickNote: tool('add_quick_note'),
  },
  'app/vault/triage/actions.ts': {
    fileQuickNoteAction: tool('file_quick_note'),
    searchTriagePlaces: none('page'),
  },
  'app/vault/map/actions.ts': {
    startSweep: none(
      'spends',
      'Marks the map sweep running and returns; the five-minute cron does the paid work across the whole vault, so it has no PAID_ACTIONS key to price a card by.',
    ),
    stopSweep: none('spends', 'Stops the sweep Start sweep began, and goes with that press.'),
    undoMerge: none('theirs'),
    renameTheme: tool('rename_theme'),
  },
  'app/vault/maya/actions.ts': {
    replyToMaya: none('theirs'),
    renameMayaQuestion: tool('rename_maya_question'),
  },
  'app/vault/n/[...path]/actions.ts': {
    proposeMap: none(
      'spends',
      'Returns a reading of the note the page shows for the person to tick, and keeps nothing until acceptMap, so a run from Dash would spend on a result no one sees.',
    ),
    acceptMap: none('theirs'),
    askMaya: tool('ask_maya'),
    saveNoteEdit: tool('edit_vault_note'),
    renameNoteAction: tool('rename_vault_note'),
  },
  'app/vault/settings/actions.ts': {
    connectVault: none('account'),
    disconnectVault: none('account'),
    rescanVault: none('page'),
  },
};
