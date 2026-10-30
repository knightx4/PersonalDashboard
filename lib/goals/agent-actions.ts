import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the Goals pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const goalsActions: ModuleActions = {
  'app/goals/actions.ts': {
    renameAreaAction: tool('change_goal_area'),
    setAreaNoteAction: tool('change_goal_area'),
    planAreaAction: none(
      'spends',
      "Only the app's owner can press it, since it starts the goals routine on the owner's routine allowance, and it has no PAID_ACTIONS key to price a card by.",
    ),
    approveAreaAction: none('theirs'),
    moveAreaAction: tool('change_goal_area'),
    archiveAreaAction: tool('change_goal_area'),
    editGoal: tool('set_goal_done_when', 'change_goal'),
    moveGoalAction: tool('change_goal'),
    archiveGoalAction: tool('change_goal'),
    settleGoalAction: tool('change_goal'),
  },
  'app/goals/[goalId]/actions.ts': {
    addStep: tool('add_goal_step'),
    editStep: tool('change_goal_step'),
    setStepStatusAction: tool('close_goal_step', 'change_goal_step'),
    setStepOnTodoAction: tool('change_goal_step', 'schedule_goal_step'),
    setStepNotifyAction: none('setting', 'Whether the phone is told when Dash finishes a step is the person\'s own choice.'),
    countRhythmAction: tool('file_count'),
    moveStepAction: tool('change_goal_step'),
    archiveStepAction: tool('change_goal_step'),
    linkStepAction: tool('change_goal_step'),
    unlinkStepAction: tool('change_goal_step'),
  },
  'app/goals/[goalId]/metric-actions.ts': {
    addMetricAction: none('setting', 'Which list a goal counts, and how often, is chosen on the goal page.'),
    changeMetricAction: none('setting'),
    removeMetricAction: none('setting'),
  },
  'app/goals/runs/[runId]/actions.ts': {
    undoRunChangeAction: none('theirs'),
    acknowledgeGoalRunAction: none('theirs'),
    answerGoalRunAction: none('theirs'),
  },
  'app/goals/suggestion-actions.ts': {
    reactToSuggestionAction: none('theirs'),
    undoDeclineAction: none('theirs', 'Undo: takes back their own decline.'),
    recordAttendedAction: tool('change_goals_inbox'),
    addSuggestedStepAction: none('theirs'),
  },
  'app/goals/inbox/actions.ts': {
    snoozeInboxRowAction: tool('change_goals_inbox'),
    unsnoozeInboxRowAction: tool('change_goals_inbox'),
    leaveQuestionsAction: none('theirs'),
    dismissStepNoticeAction: none('own', 'Marks a finished-step notice as read, which means something only when the person has read it.'),
    restoreStepNoticeAction: none('theirs', 'Undo: takes back their own dismissal.'),
  },
  'app/goals/[goalId]/learn-actions.ts': {
    setLearnDepth: none('setting'),
    setLearnKind: none('setting', 'Which kind of goal it is steers which sources a draft pulls; Dash sorts it on save and the person corrects it here.'),
  },
  'app/goals/[goalId]/document-actions.ts': {
    readIntoFormAction: none(
      'spends',
      'Reads pasted text or a document into rows the form shows for the person to check, and keeps nothing until they save them, so a run from Dash would spend on a result no one sees.',
    ),
    addSuggestedFieldAction: none('theirs'),
    saveDocumentKindAction: tool('change_goal_form'),
    forgetDocumentKindAction: tool('change_goal_form'),
  },
  'app/goals/[goalId]/block-actions.ts': {
    setGoalStepStatus: tool('close_goal_step', 'change_goal_step'),
    blockGoalStep: tool('change_goal_step'),
    addGoalStepDependency: tool('change_goal_step'),
    removeGoalStepDependency: tool('change_goal_step'),
  },
  'app/goals/[goalId]/flag-actions.ts': {
    answerFlagAction: none('theirs'),
    deleteFlagCommentAction: none('deletes'),
    dismissFlagAction: none('theirs'),
  },
  'app/goals/[goalId]/comment-actions.ts': {
    addGoalComment: none('theirs'),
    deleteGoalComment: none('deletes'),
  },
  'app/goals/[goalId]/tree-actions.ts': {
    answerGoalQuestion: none('theirs'),
    dismissGoalQuestion: none('theirs'),
    askGoalQuestion: none('theirs'),
  },
  'app/goals/[goalId]/information-actions.ts': {
    saveRecordAction: tool('file_goal_record'),
    savePreviewAction: none('page'),
    confirmRecordAction: none('theirs'),
    archiveRecordAction: tool('change_goal_form'),
    saveQuestionsAction: tool('change_goal_form'),
  },
  'app/goals/[goalId]/list-actions.ts': {
    addGoalListAction: tool('change_goal_list'),
    addListRowAction: tool('change_goal_list'),
    confirmListRowAction: tool('change_goal_list'),
  },
  'app/goals/[goalId]/link-actions.ts': {
    linkAimAction: tool('change_goal_link'),
    linkJobSearchAction: tool('change_goal_link'),
    linkRowAction: tool('change_goal_link'),
    unlinkAction: tool('change_goal_link'),
  },
  'app/goals/[goalId]/reading-actions.ts': {
    setMeasureAction: tool('change_goal_number'),
    addReadingAction: tool('file_reading'),
    deleteReadingAction: none('deletes'),
    setNumberFromAction: tool('change_goal_number'),
  },
  'app/goals/[goalId]/context-actions.ts': {
    setContextStatusAction: none('theirs'),
  },
  'app/goals/[goalId]/shaping-actions.ts': {
    workOnGoalAction: tool('start_goal_run', 'pass_to_routine'),
    askDashStepAction: tool('work_goal_step', 'take_step'),
    readResultAction: none('page'),
    approveGoalAction: tool('change_goal', 'approve_goal'),
    answerQuestionAction: none('theirs'),
    setQuestionAsideAction: none('theirs'),
    settleProposalAction: none('theirs'),
    undoDeclineProposalAction: none('theirs', 'Undo: takes back their own decline.'),
  },
  'app/goals/[goalId]/help-actions.ts': {
    setHelpKindsAction: none('setting'),
    turnDownHelpAction: none('theirs'),
    restoreHelpProposalAction: none('theirs', 'Undo: takes back their own decline.'),
  },
  'app/goals/files/[fileId]/read-actions.ts': {
    markFileReadAction: none('own', 'Opening the file marks it read, which means the person read it.'),
  },
  'app/goals/home-actions.ts': {
    setAsideAction: tool('change_goal_step'),
    restoreAsideAction: tool('change_goal_step'),
    bringBackAction: tool('change_goal_step'),
    askDashAction: none(
      'spends',
      'Asks Dash from the Goals home, as an @dash comment on a goal or by handing it an errand; an agent asking is already the one asking.',
    ),
  },
  'app/goals/capture-actions.ts': {
    fileGoalCapture: tool('file_close', 'file_count', 'file_progress', 'file_reading', 'file_add'),
    sortGoalCapture: none('page'),
    undoGoalCapture: none('theirs'),
    estimateGoalCapture: none('page'),
    goalCaptureCosts: none('page'),
  },
  'app/goals/mention-actions.ts': {
    dismissMentionAction: none('theirs'),
    undismissMentionAction: none('theirs'),
  },
  'app/goals/settings/actions.ts': {
    setGoalRun: none('setting'),
  },
};
