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
  add_todo: [
    'app/todo/actions.ts#addTask',
    'app/todo/link-actions.ts#addLinkedTask',
  ],
  change_todo: [
    'app/todo/actions.ts#editTask',
    'app/todo/actions.ts#renameTaskAction',
    'app/todo/actions.ts#rescheduleTaskAction',
  ],
  close_todo: ['app/todo/actions.ts#completeTask'],
  add_goal: ['app/learn/know/level3-actions.ts#addLevel3Goal'],
  mark_returned: ['app/shopping/inventory/actions.ts#markInventoryReturned'],
  add_role_note: ['app/jobs/(app)/roles/[id]/actions.ts#addNote'],
  add_idea: [
    'app/dev/ideas/actions.ts#addIdea',
    'app/dev/ideas/actions.ts#submitIdea',
  ],
  change_items: [
    'app/shopping/inventory/actions.ts#disposeInventoryItem',
    'app/shopping/inventory/actions.ts#quickDisposeInventoryItem',
    'app/shopping/inventory/actions.ts#setItemsForSale',
    'app/shopping/inventory/actions.ts#toggleItemForSaleForm',
    'app/shopping/inventory/group-actions.ts#separateCopy',
    'app/shopping/inventory/group-actions.ts#ungroupItems',
    'app/shopping/returns/actions.ts#setReturnPlanned',
    'app/shopping/returns/actions.ts#toggleReturnPlannedForm',
    'app/shopping/returns/actions.ts#setItemsReturnPlanned',
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
  edit_todo: [
    'app/todo/actions.ts#editTask',
    'app/todo/actions.ts#reopenTask',
    'app/todo/actions.ts#dropTask',
    'app/todo/actions.ts#pinTask',
    'app/todo/actions.ts#bringBackTask',
    'app/todo/actions.ts#tagTask',
  ],
  add_todo_item: ['app/todo/actions.ts#addItem'],
  link_todo: [
    'app/todo/actions.ts#pointTaskAt',
    'app/todo/link-actions.ts#addLinkedTask',
  ],
  add_event: ['app/todo/calendar/actions.ts#addEvent'],
  change_event: ['app/todo/calendar/actions.ts#editEvent'],
  change_agenda_row: [
    'app/todo/source-actions.ts#completeItem',
    'app/todo/source-actions.ts#deferItem',
    'app/todo/source-actions.ts#dismissItem',
  ],
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
  change_item: [
    'app/shopping/inventory/actions.ts#updateInventoryItem',
    'app/shopping/inventory/group-actions.ts#renameItemGroup',
    'app/shopping/inventory/book-actions.ts#confirmBookEdition',
    'app/shopping/inventory/book-actions.ts#updateBookCondition',
    'app/shopping/inventory/game-actions.ts#confirmGameEdition',
    'app/shopping/sell/actions.ts#noteListingIntent',
    'app/shopping/sell/actions.ts#setSellPrice',
  ],
  item_lists: [
    'app/shopping/settings/actions.ts#createItemList',
    'app/shopping/settings/actions.ts#renameItemList',
    'app/shopping/inventory/actions.ts#updateInventoryItemLists',
    'app/shopping/inventory/actions.ts#createItemListAndAssign',
    'app/shopping/inventory/actions.ts#toggleInventoryItemList',
  ],
  add_items: [
    'app/shopping/inventory/book-actions.ts#saveOwnedBook',
    'app/shopping/inventory/game-actions.ts#saveGame',
    'app/shopping/inventory/item-actions.ts#saveManualItem',
  ],
  change_saved_item: [
    'app/shopping/saved/actions.ts#createSavedItem',
    'app/shopping/saved/actions.ts#updateSavedItem',
    'app/shopping/saved/actions.ts#markSavedPurchased',
    'app/shopping/saved/actions.ts#dismissSavedItem',
    'app/shopping/saved/actions.ts#restoreSavedItem',
  ],
  order_item_tags: [
    'app/shopping/orders/actions.ts#addOrderItemTag',
    'app/shopping/orders/actions.ts#removeOrderItemTag',
  ],
  review_orders: [
    'app/shopping/orders/actions.ts#restoreDeletedOrder',
    'app/shopping/review/actions.ts#confirmOrderReview',
    'app/shopping/review/actions.ts#discardOrderReview',
    'app/shopping/review/actions.ts#dismissEmailReview',
    'app/shopping/review/actions.ts#confirmOrdersReview',
    'app/shopping/review/actions.ts#unconfirmOrdersReview',
    'app/shopping/review/actions.ts#discardOrdersReview',
    'app/shopping/review/actions.ts#restoreDiscardedOrders',
    'app/shopping/review/actions.ts#dismissEmailsReview',
    'app/shopping/review/actions.ts#restoreDismissedEmails',
  ],
  return_window: [
    'app/shopping/returns/actions.ts#saveMerchantReturnPolicy',
    'app/shopping/returns/actions.ts#createMerchantReturnPolicy',
  ],
  change_person: [
    'app/shopping/settings/people-actions.ts#addPerson',
    'app/shopping/settings/people-actions.ts#updatePerson',
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
  write_cover_letter: ['app/jobs/(app)/roles/[id]/actions.ts#saveCoverLetter'],
};

/** Every listed pair, as `tool file#export`. */
export function driftedPairs(): string[] {
  return Object.entries(DRIFTED_BUTTONS).flatMap(([tool, actions]) => actions.map((action) => `${tool} ${action}`));
}
