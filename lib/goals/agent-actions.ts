import { GAP, none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the Goals pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const goalsActions: ModuleActions = {
  'app/goals/actions.ts': {
    addArea: tool('change_goal_area'),
    renameAreaAction: tool('change_goal_area'),
    setAreaNoteAction: tool('change_goal_area'),
    planAreaAction: none('spends'),
    approveAreaAction: none('theirs'),
    moveAreaAction: tool('change_goal_area'),
    archiveAreaAction: tool('change_goal_area'),
    addGoal: tool('add_goal'),
    editGoal: tool('set_goal_done_when', 'change_goal'),
    moveGoalAction: tool('change_goal'),
    archiveGoalAction: tool('change_goal'),
    settleGoalAction: tool('change_goal'),
  },
  'app/goals/[goalId]/actions.ts': {
    addStep: tool('add_goal_step'),
    editStep: tool('change_goal_step'),
    setStepStatusAction: tool('close_goal_step', 'change_goal_step'),
    setStepOnTodoAction: tool('schedule_goal_step'),
    countRhythmAction: tool('file_count'),
    moveStepAction: tool('change_goal_step'),
    archiveStepAction: tool('change_goal_step'),
    linkStepAction: tool('change_goal_step'),
    unlinkStepAction: tool('change_goal_step'),
  },
  'app/goals/runs/[runId]/actions.ts': {
    undoRunChangeAction: none('theirs'),
    acknowledgeGoalRunAction: none('theirs'),
    answerGoalRunAction: none('theirs'),
  },
  'app/goals/suggestion-actions.ts': {
    reactToSuggestionAction: none('theirs'),
    recordAttendedAction: GAP,
    addSuggestedStepAction: none('theirs'),
  },
  'app/goals/inbox/actions.ts': {
    snoozeInboxRowAction: GAP,
    unsnoozeInboxRowAction: GAP,
  },
  'app/goals/[goalId]/learn-actions.ts': {
    setLearnDepth: none('setting'),
  },
  'app/goals/[goalId]/document-actions.ts': {
    readIntoFormAction: none('spends'),
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
  'app/goals/[goalId]/link-actions.ts': {
    linkAimAction: tool('change_goal_link'),
    linkJobSearchAction: tool('change_goal_link'),
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
    workOnGoalAction: tool('pass_to_routine'),
    askDashStepAction: tool('take_step'),
    readResultAction: none('page'),
    approveGoalAction: none('theirs'),
    answerQuestionAction: none('theirs'),
    setQuestionAsideAction: none('theirs'),
    settleProposalAction: none('theirs'),
  },
  'app/goals/[goalId]/help-actions.ts': {
    setHelpKindsAction: none('setting'),
    turnDownHelpAction: none('theirs'),
  },
  'app/goals/files/[fileId]/read-actions.ts': {
    markFileReadAction: none('own', 'Opening the file marks it read, which means the person read it.'),
  },
  'app/goals/home-actions.ts': {
    setAsideAction: GAP,
    restoreAsideAction: GAP,
    bringBackAction: GAP,
    askDashAction: none('spends'),
  },
  'app/goals/capture-actions.ts': {
    fileGoalCapture: tool('file_close', 'file_count', 'file_progress', 'file_reading', 'file_add'),
    sortGoalCapture: none('page'),
    undoGoalCapture: none('theirs'),
    estimateGoalCapture: none('page'),
    goalCaptureCosts: none('page'),
  },
};
