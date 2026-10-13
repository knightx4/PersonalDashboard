import { GAP, none, type ModuleActions } from '@/lib/agent-actions/types';

/** What the You pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const youActions: ModuleActions = {
  // Transcripts and courses on Work & school, moved from the Vault (plan #1991.3).
  'app/you/work/actions.ts': {
    readTranscriptAction: none('spends'),
    saveTranscriptAction: GAP,
    discardUploadAction: none('page'),
    updateCourseAction: GAP,
    removeCourseAction: none('deletes'),
    removeTranscriptAction: none('deletes'),
  },
};
