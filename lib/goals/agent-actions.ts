import { GAP, gap, none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the Goals pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const goalsActions: ModuleActions = {
  'app/goals/actions.ts': {
    addArea: GAP,
    renameAreaAction: GAP,
    setAreaNoteAction: GAP,
    planAreaAction: none('spends'),
    approveAreaAction: none('theirs'),
    moveAreaAction: GAP,
    archiveAreaAction: GAP,
    addGoal: tool('add_goal'),
    editGoal: gap("Set a goal's done-when and wording (plan #1897)."),
    moveGoalAction: GAP,
    archiveGoalAction: GAP,
    settleGoalAction: GAP,
  },
  'app/goals/[goalId]/actions.ts': {
    addStep: tool('add_goal_step'),
    editStep: GAP,
    setStepStatusAction: gap('close_goal_step closes a step; no tool sets any other status.'),
    setStepOnTodoAction: tool('schedule_goal_step'),
    countRhythmAction: tool('file_count'),
    moveStepAction: GAP,
    archiveStepAction: GAP,
    linkStepAction: GAP,
    unlinkStepAction: GAP,
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
    saveDocumentKindAction: GAP,
    forgetDocumentKindAction: GAP,
  },
  'app/goals/[goalId]/block-actions.ts': {
    setGoalStepStatus: gap('close_goal_step closes a step; no tool sets any other status.'),
    blockGoalStep: GAP,
    addGoalStepDependency: GAP,
    removeGoalStepDependency: GAP,
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
    archiveRecordAction: GAP,
    saveQuestionsAction: GAP,
  },
  'app/goals/[goalId]/link-actions.ts': {
    linkAimAction: GAP,
    linkJobSearchAction: GAP,
    unlinkAction: GAP,
  },
  'app/goals/[goalId]/reading-actions.ts': {
    setMeasureAction: GAP,
    addReadingAction: tool('file_reading'),
    deleteReadingAction: none('deletes'),
    setNumberFromAction: GAP,
  },
  'app/goals/[goalId]/context-actions.ts': {
    setContextStatusAction: GAP,
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
    markFileReadAction: GAP,
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
