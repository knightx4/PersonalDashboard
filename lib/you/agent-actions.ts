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
    readAgainAction: tool('read_personality_again'),
  },
  // Transcripts and courses on Work & school, moved from the Vault (plan #1991.3).
  'app/you/work/actions.ts': {
    readTranscriptAction: none(
      'spends',
      'Reads a transcript the person has just uploaded into a list of courses for them to check, and keeps nothing until they save it; Dash keeps a transcript with save_transcript.',
    ),
    saveTranscriptAction: tool('save_transcript'),
    discardUploadAction: none('page'),
    updateCourseAction: tool('change_course'),
    removeCourseAction: none('deletes'),
    answerCourseExplainAction: none(
      'own',
      'The explain answer is what the person writes about a course, graded on a press; Dash does not answer for them.',
    ),
    removeTranscriptAction: none('deletes'),
  },
  'app/you/places/actions.ts': {
    // A place is added through capture (plan #1950.7); the form only changes one.
    savePlace: tool('change_place'),
    removePlace: none('deletes'),
    placeOnMap: none(
      'own',
      'A press on the map is the person pointing at where a place is; Dash places a place from its city when it saves it.',
    ),
    worldMap: none('page'),
  },
  'app/you/details/actions.ts': {
    saveDetailsForm: none(
      'own',
      'Your phone, LinkedIn, citizenship, race, gender and sexuality are what you say about yourself; Dash reads them (plan #2124.3) and does not change them.',
    ),
  },
  // Jobs read from the default résumé, on the same tab (plan #1991.4).
  'app/you/work/job-actions.ts': {
    readResumeAction: tool('read_resume_jobs'),
    saveJobAction: tool('save_job'),
    removeJobAction: none('deletes'),
  },
};
