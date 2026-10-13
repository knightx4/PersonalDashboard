import { GAP, none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the Vault pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const vaultActions: ModuleActions = {
  'app/vault/actions.ts': {
    dismissNoteConnection: none('theirs'),
    newVaultNote: GAP,
    addQuickNote: tool('add_quick_note'),
  },
  'app/vault/triage/actions.ts': {
    fileQuickNoteAction: GAP,
    searchTriagePlaces: none('page'),
  },
  'app/vault/education/actions.ts': {
    readTranscriptAction: none('spends'),
    saveTranscriptAction: GAP,
    discardUploadAction: none('page'),
    updateCourseAction: GAP,
    removeCourseAction: none('deletes'),
    removeTranscriptAction: none('deletes'),
  },
  'app/vault/map/actions.ts': {
    startSweep: none('spends'),
    stopSweep: none('spends'),
    undoMerge: none('theirs'),
    renameTheme: GAP,
  },
  'app/vault/maya/actions.ts': {
    replyToMaya: none('theirs'),
    renameMayaQuestion: GAP,
  },
  'app/vault/n/[...path]/actions.ts': {
    proposeMap: none('spends'),
    acceptMap: none('theirs'),
    askMaya: none('spends'),
    saveNoteEdit: GAP,
    renameNoteAction: GAP,
  },
  'app/vault/settings/actions.ts': {
    connectVault: none('account'),
    disconnectVault: none('account'),
    rescanVault: none('page'),
  },
};
