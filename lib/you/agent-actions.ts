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
      "Corrects the topic Dash read for a week; the person's correction is what a later read keeps, so it is theirs to make.",
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
    answerInsight: none(
      'theirs',
      "An answer to a card's question is the person's own words about themselves; Dash reads it and does not write it.",
    ),
    saveNowNote: none(
      'theirs',
      'Where they are now is their own account of their situation; Dash reads it before every insights run and does not write it.',
    ),
    importClaudeChats: none(
      'theirs',
      'Importing their claude.ai export is their choice of what Dash may read; the connector saves single moments with save_about_me instead.',
    ),
    refreshInsights: none('page'),
    startInsightRun: none(
      'spends',
      'Look again starts a long Dash session on the account, which spends money the person chooses to spend.',
    ),
  },
  // The person's marks on the board's minutes (plan #2540.3).
  'app/you/board/make-actions.ts': {
    makeDecisionHappen: none(
      'theirs',
      'Turning a decision into todos or goal steps is the person taking up what they decided; Dash does not write them for them (plan #2561.9).',
    ),
  },
  'app/you/board/actions.ts': {
    voteOnDisagreement: none(
      'theirs',
      "Siding with a seat on the board's disagreement is the person's own call; the next meeting reads it and Dash does not vote for them.",
    ),
    answerBoardQuestion: none(
      'theirs',
      "An answer to the board's question is the person's own words; the next meeting starts from it.",
    ),
    markResolution: none(
      'theirs',
      'Ticking a resolution done is the person saying they did it; the next meeting reads the tick.',
    ),
    askBoard: tool('ask_board'),
    answerBoardAsk: none(
      'theirs',
      "An answer to what the board asked is the person's own words, which the next meeting reads first (plan #2561.11).",
    ),
    acceptSuggestion: none(
      'spends',
      "Taking up one of the board's suggested questions is the person's choice of what the board works on, and Ask now starts a paid Dash session (plan #2561.4).",
    ),
    dismissSuggestion: none(
      'theirs',
      "Turning down a suggested question is the person's call on what the board should not spend its time on.",
    ),
    conveneQuestion: none(
      'spends',
      'Convening the board now about a queued question starts a long Dash session on the account, which spends money the person chooses to spend (plan #2561.4).',
    ),
    decideQuestion: none(
      'theirs',
      "Deciding a debated question, or putting it off or turning it down, is the person's own call on the board's verdict; the next meeting reads it and Dash does not decide for them (plan #2561.6).",
    ),
    makeResolutionTodo: none(
      'theirs',
      'Making a resolution a todo is the person taking up what the board proposed, an approval Dash does not give for them.',
    ),
    addBoardAdvisor: none(
      'spends',
      "Adding a guest is the person's choice of who sits on their board, and it starts a Dash session on the account that builds the brain from their public work (plan #2561.7).",
    ),
    retryAdvisorBrain: none(
      'spends',
      'Retrying a failed brain starts the same paid Dash session again, which the person chooses to spend (plan #2561.7).',
    ),
    setAdvisorActive: none(
      'theirs',
      "Whether the chair may bring a guest in is the person's own call on who sits on their board (plan #2561.7).",
    ),
    createBoardPanel: none(
      'theirs',
      "A panel is the person's own grouping of who they want to hear from; they make and name it themselves (plan #2561.12).",
    ),
    renameBoardPanel: none('theirs', "Naming a panel is the person's own grouping of advisors (plan #2561.12)."),
    setBoardPanelAdvisors: none(
      'theirs',
      "Who sits on a panel is the person's own call on whom to hear from (plan #2561.12).",
    ),
    deleteBoardPanel: none('deletes'),
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
