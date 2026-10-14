import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/**
 * What the You pages let the person do, and the tool that does each
 * (lib/agent-actions/types.ts). Taking a personality test and typing in a
 * type are the person's own results, which no agent enters for them.
 */
export const youActions: ModuleActions = {
  'app/you/personality/actions.ts': {
    saveBigFiveAction: none('own'),
    saveTypedAction: none(
      'own',
      "A type from another test is the person's own result, entered by them as their Big Five scores are, and saving it starts a read of it.",
    ),
    deleteTypedAction: none('deletes'),
    restoreTypedAction: none('theirs'),
    readAgainAction: none('spends'),
  },
  // Transcripts and courses on Work & school, moved from the Vault (plan #1991.3).
  'app/you/work/actions.ts': {
    readTranscriptAction: none('spends'),
    saveTranscriptAction: tool('save_transcript'),
    discardUploadAction: none('page'),
    updateCourseAction: tool('change_course'),
    removeCourseAction: none('deletes'),
    removeTranscriptAction: none('deletes'),
  },
  'app/you/places/actions.ts': {
    // A place is added through capture (plan #1950.7); the form only changes one.
    savePlace: tool('change_place'),
    removePlace: none('deletes'),
  },
  // Jobs read from the default résumé, on the same tab (plan #1991.4).
  'app/you/work/job-actions.ts': {
    readResumeAction: none('spends'),
    saveJobAction: tool('save_job'),
    removeJobAction: none('deletes'),
  },
};
