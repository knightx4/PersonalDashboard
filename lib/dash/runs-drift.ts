/**
 * The free Dash tools that do not yet call what their buttons call (plan
 * #2473.1): for each tool, the buttons (as the server action's `file#export`)
 * whose function, named in the tool's `runs` (./runs.ts), the tool does not
 * reach. lib/dash/runs.test.ts holds the list to the code in both
 * directions, so a pair comes off it as soon as it holds.
 *
 * It may only get shorter. The `dash-tools-off-their-button` counter in
 * scripts/spec-counts.ts counts the pairs, and the gate refuses a count that
 * rises: a new write tool starts out calling its button's function, or says
 * why no button does what it does. Steps #2473.2 to #2473.5 work it down,
 * workspace by workspace.
 */
export const DRIFTED_BUTTONS: Readonly<Record<string, readonly string[]>> = {
  add_goal: ['app/learn/know/level3-actions.ts#addLevel3Goal'],
  add_role_note: ['app/jobs/(app)/roles/[id]/actions.ts#addNote'],
  add_idea: [
    'app/dev/ideas/actions.ts#addIdea',
    'app/dev/ideas/actions.ts#submitIdea',
  ],
  add_quick_note: ['app/vault/actions.ts#addQuickNote'],
  change_reading: [
    'app/learn/r/[id]/actions.ts#attachSource',
    'app/learn/r/[id]/actions.ts#updateStatus',
    'app/learn/r/[id]/actions.ts#toggleReadNow',
    'app/learn/r/[id]/actions.ts#updateNote',
    'app/learn/r/[id]/actions.ts#saveReadingText',
    'app/learn/r/[id]/actions.ts#saveReadingPdf',
    'app/learn/r/[id]/actions.ts#clearReadingText',
  ],
  add_learn_track: ['app/learn/lists/actions.ts#startTrack'],
  add_track_reading: [
    'app/learn/c/[id]/actions.ts#queueMaterial',
    'app/learn/save/actions.ts#saveReadingLink',
    'app/learn/t/[id]/actions.ts#addToTrack',
  ],
  add_concept_note: [
    'app/learn/c/[id]/actions.ts#addConceptNote',
    'app/learn/now/actions.ts#addCardNote',
  ],
  change_video: ['app/learn/videos/actions.ts#setWatchedAction'],
  change_place: ['app/you/places/actions.ts#savePlace'],
  save_job: ['app/you/work/job-actions.ts#saveJobAction'],
  mark_issue_unread: ['app/news/i/[id]/actions.ts#markIssueUnread'],
  save_story: ['app/news/saved/actions.ts#removeSaved'],
  make_todo_from_story: ['app/news/i/[id]/actions.ts#makeTodoFromStory'],
  stop_watch: ['app/home/actions.ts#stopWatch'],
  change_goal_area: ['app/goals/actions.ts#moveAreaAction'],
  change_goal_step: [
    'app/goals/[goalId]/actions.ts#moveStepAction',
    'app/goals/[goalId]/block-actions.ts#blockGoalStep',
  ],
  write_vault_note: ['app/vault/actions.ts#newVaultNote'],
  edit_vault_note: ['app/learn/e/[id]/notes-to-vault-actions.ts#addEssayNotesToVaultNote'],
  rename_theme: ['app/vault/map/actions.ts#renameTheme'],
  rename_maya_question: ['app/vault/maya/actions.ts#renameMayaQuestion'],
  change_course: ['app/you/work/actions.ts#updateCourseAction'],
  save_transcript: ['app/you/work/actions.ts#saveTranscriptAction'],
  change_interview_round: ['app/jobs/(app)/roles/[id]/interview-actions.ts#groupInterviews'],
  rewrite_post: ['app/dev/posts/actions.ts#editPostBody'],
  suggest_post: ['app/dev/posts/actions.ts#suggestPostAbout'],
  file_idea: [
    'app/dev/ideas/actions.ts#addIdea',
    'app/dev/ideas/actions.ts#submitIdea',
  ],
  file_note: [
    'app/dev/bugs/actions.ts#submitFeedback',
    'app/dev/surfaces/actions.ts#noteOnSurface',
  ],
  add_step: ['app/dev/plan/actions.ts#addPlanItem'],
  reword: [
    'app/dev/bugs/actions.ts#editFeedback',
    'app/dev/ideas/actions.ts#updateIdea',
    'app/dev/plan/actions.ts#updatePlanItem',
    'app/dev/plan/actions.ts#updateFeature',
  ],
  build_step: [
    'app/dev/plan/actions.ts#addPlanItem',
    'app/dev/plan/actions.ts#sendPlanItemToClaude',
  ],
  move_goal_step: ['app/goals/[goalId]/actions.ts#moveStepAction'],
};

/** Every listed pair, as `tool file#export`. */
export function driftedPairs(): string[] {
  return Object.entries(DRIFTED_BUTTONS).flatMap(([tool, actions]) => actions.map((action) => `${tool} ${action}`));
}
