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
    addCourseFileAction: none(
      'own',
      'Keeps a file the person has just uploaded under a course, as they chose its kind and week; Dash does not hold their files.',
    ),
    removeCourseFileAction: none('deletes'),
    summariseCourseFileAction: none(
      'spends',
      'Has Dash read one course file and keep its summary and key points, paid for on each press, which the person decided to make only by pressing Summarise (plan #2401.3).',
    ),
    readSyllabusWeeksAction: none(
      'spends',
      "Has Dash read a course's syllabus and lay out its weeks, paid for on each press, which the person decided to make only by pressing (plan #2401.3).",
    ),
    collectCourseOverviewAction: none(
      'spends',
      "Has Dash read a course's file summaries and say what the course was about and which ideas recurred, paid for on each press, which the person decided to make only by pressing (plan #2401.3).",
    ),
    renameCourseWeekAction: none(
      'theirs',
      'Corrects the topic Dash read for a week; the person\'s correction is what a later read keeps, so it is theirs to make.',
    ),
    removeCourseWeekAction: none(
      'theirs',
      'Turns down a week Dash read from the syllabus, so a later read leaves it out; a verdict on what Dash laid out.',
    ),
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
  'app/you/insights/actions.ts': {
    markInsight: none(
      'theirs',
      "Right, not quite or wrong is the person's verdict on what Dash wrote about them; Dash does not mark its own insights.",
    ),
    startInsightRun: none(
      'spends',
      'Look again makes one long model call on the account, which spends money the person chooses to spend.',
    ),
    startFullReread: none(
      'spends',
      'Full re-read starts a long Dash session on the account, which spends money the person chooses to spend.',
    ),
  },
  'app/you/details/actions.ts': {
    saveDetailsForm: none(
      'own',
      'Your phone, LinkedIn, citizenship, race, gender and sexuality are what you say about yourself; Dash reads them (plan #2124.3) and does not change them. The fields you name yourself it sets by label with set_detail (plan #2531.3).',
    ),
  },
  // Jobs read from the default résumé, on the same tab (plan #1991.4).
  'app/you/work/job-actions.ts': {
    readResumeAction: tool('read_resume_jobs'),
    saveJobAction: tool('save_job'),
    removeJobAction: none('deletes'),
  },
};
