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
  move_roles: ['app/jobs/(app)/pipeline/actions.ts#moveApplication'],
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
  change_role: [
    'app/jobs/(app)/roles/actions.ts#updateRole',
    'app/jobs/(app)/roles/[id]/actions.ts#renameRole',
    'app/jobs/(app)/roles/[id]/actions.ts#moveRoleToCompany',
  ],
  change_application: [
    'app/jobs/(app)/pipeline/actions.ts#setExcitement',
    'app/jobs/(app)/pipeline/actions.ts#setChannel',
    'app/jobs/(app)/roles/[id]/actions.ts#saveApplicationMarks',
  ],
  save_answer: [
    'app/jobs/(app)/roles/actions.ts#saveAnswer',
    'app/jobs/(app)/roles/actions.ts#saveDraftedAnswer',
  ],
  set_default_answer: ['app/jobs/(app)/roles/actions.ts#promoteToCanonical'],
  change_company: [
    'app/jobs/(app)/companies/actions.ts#updateCompany',
    'app/jobs/(app)/companies/actions.ts#renameCompany',
  ],
  add_company: ['app/jobs/(app)/companies/actions.ts#addCompany'],
  merge_roles: ['app/jobs/(app)/companies/actions.ts#mergeRoles'],
  change_reminder: [
    'app/jobs/(app)/_home/actions.ts#completeReminder',
    'app/jobs/(app)/_home/actions.ts#snoozeReminder',
    'app/jobs/(app)/roles/[id]/timeline-actions.ts#updateReminder',
    'app/jobs/(app)/roles/[id]/timeline-actions.ts#linkReminderMessage',
  ],
  change_waiting: [
    'app/jobs/(app)/_home/actions.ts#completeWaiting',
    'app/jobs/(app)/_home/actions.ts#snoozeWaiting',
  ],
  change_role_email: [
    'app/jobs/(app)/roles/[id]/mail-actions.ts#unlinkMessage',
    'app/jobs/(app)/roles/[id]/mail-actions.ts#linkCandidateMessage',
    'app/jobs/(app)/roles/[id]/mail-actions.ts#declineCandidateMessage',
  ],
  review_application: [
    'app/jobs/(app)/review/actions.ts#confirmApplication',
    'app/jobs/(app)/review/actions.ts#reopenApplication',
  ],
  review_events: [
    'app/jobs/(app)/review/actions.ts#acknowledgeEvent',
    'app/jobs/(app)/review/actions.ts#acknowledgeEvents',
    'app/jobs/(app)/review/actions.ts#unacknowledgeEvents',
  ],
  review_emails: [
    'app/jobs/(app)/review/actions.ts#dismissMessage',
    'app/jobs/(app)/review/actions.ts#dismissMessages',
    'app/jobs/(app)/review/actions.ts#restoreDismissedMessages',
  ],
  change_contact: [
    'app/jobs/(app)/contacts/actions.ts#createContact',
    'app/jobs/(app)/contacts/actions.ts#updateContact',
  ],
  change_touch: [
    'app/jobs/(app)/contacts/actions.ts#logTouch',
    'app/jobs/(app)/contacts/actions.ts#updateTouch',
    'app/jobs/(app)/contacts/actions.ts#markTouchSent',
    'app/jobs/(app)/contacts/actions.ts#markTouchAnswered',
  ],
  mark_suggestion_sent: ['app/jobs/(app)/find/recommend-actions.ts#markSuggestionSent'],
  add_role_from_email: ['app/jobs/(app)/review/actions.ts#createRoleFromMessage'],
  add_evidence: ['app/jobs/(app)/material/evidence-actions.ts#addEvidence'],
  add_resume_version: ['app/jobs/(app)/material/evidence-actions.ts#addResumeVersion'],
  attach_resume_pdf: ['app/jobs/(app)/material/evidence-actions.ts#attachResumePdf'],
  change_career_thought: [
    'app/jobs/(app)/settings/career-goal-actions.ts#addThought',
    'app/jobs/(app)/settings/career-goal-actions.ts#updateThought',
  ],
  add_discovered_company: [
    'app/jobs/(app)/companies/actions.ts#addCompany',
    'app/jobs/(app)/find/actions.ts#addDiscoveredCompany',
  ],
  change_interview: ['app/jobs/(app)/roles/[id]/interview-actions.ts#saveInterview'],
  change_interviewer: [
    'app/jobs/(app)/roles/[id]/interview-actions.ts#addInterviewer',
    'app/jobs/(app)/roles/[id]/interview-actions.ts#addInterviewerByName',
    'app/jobs/(app)/roles/[id]/interview-actions.ts#removeInterviewer',
  ],
  change_interview_round: [
    'app/jobs/(app)/roles/[id]/interview-actions.ts#groupInterviews',
    'app/jobs/(app)/roles/[id]/interview-actions.ts#saveInterviewGroup',
    'app/jobs/(app)/roles/[id]/interview-actions.ts#unlinkRoundMessage',
    'app/jobs/(app)/roles/[id]/interview-actions.ts#ungroupInterview',
  ],
  link_round_email: ['app/jobs/(app)/roles/[id]/interview-actions.ts#linkRoundMessage'],
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
  write_cover_letter: ['app/jobs/(app)/roles/[id]/actions.ts#saveCoverLetter'],
};

/** Every listed pair, as `tool file#export`. */
export function driftedPairs(): string[] {
  return Object.entries(DRIFTED_BUTTONS).flatMap(([tool, actions]) => actions.map((action) => `${tool} ${action}`));
}
