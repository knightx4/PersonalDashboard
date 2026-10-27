import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/**
 * Why a dev page's press that spends has no paid tool (plan #2228.5): the
 * paid tools are for the workspaces, and feature #2228 kept the dev routines
 * out of them.
 */
const DEV_SPENDS =
  "Starts a dev routine or a model run on the app's own development (the overnight runner, a feature routine, shaping, a review), which stays a press on the dev pages rather than a paid tool Dash queues.";

/** What the Dev pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const devActions: ModuleActions = {
  'app/dev/bugs/actions.ts': {
    submitFeedback: tool('file_note'),
    triageFiled: none('spends', DEV_SPENDS),
    updateFeedbackStatus: none('session', 'scripts/notes.ts start, done, block and decline.'),
    editFeedback: tool('reword'),
    respondToFeedback: none('theirs'),
    deleteFeedback: none('deletes'),
    runFeatureRoutine: none('spends', DEV_SPENDS),
    routineRun: none('page'),
    openFeedbackCount: none('page'),
    setFeedbackPriority: none('session', 'scripts/notes.ts priority.'),
    flipFiled: none('theirs', 'Corrects how the person just filed something, from the panel shown after filing.'),
  },
  'app/dev/ideas/actions.ts': {
    addIdea: tool('file_idea', 'add_idea'),
    submitIdea: tool('file_idea', 'add_idea'),
    updateIdea: tool('reword'),
    dismissIdea: none('theirs'),
    restoreIdea: none('theirs'),
    deleteIdea: none('deletes'),
    shapeIdea: none('spends', DEV_SPENDS),
  },
  'app/dev/inspiration/actions.ts': {
    setInspirationPlaylist: none('setting'),
    checkInspirationNow: none('spends', DEV_SPENDS),
    craftTakeaway: none('spends', DEV_SPENDS),
    dismissTakeaway: none('theirs'),
    restoreTakeaway: none('theirs'),
  },
  'app/dev/plan/actions.ts': {
    addPlanItem: tool('add_step'),
    updatePlanItem: tool('reword'),
    setPlanItemStatus: none('session', 'scripts/plan.ts start, done, block, reopen and drop.'),
    dismissPlanDecision: none('theirs'),
    approvePlanItem: none('theirs'),
    approveProposals: none('theirs'),
    setPlanItemAssignee: none('session', 'scripts/plan.ts assign.'),
    setPlanItemPriority: none('session', 'scripts/plan.ts priority.'),
    movePlanItem: none('setting', 'The order of steps under a feature is how the person arranges their own plan.'),
    answerPlanDecision: none('theirs'),
    answerBlockedStep: none('theirs'),
    acceptCriticStop: none('theirs'),
    deletePlanItem: none('deletes'),
    addPlanDependency: none('session', 'scripts/plan.ts depends.'),
    removePlanDependency: none('session', 'scripts/plan.ts undepend.'),
    sendPlanItemToClaude: tool('send_step'),
    sendPlanFeatureToClaude: none('spends', 'Starts sessions on every ready step of a feature; send_step starts one from its thread.'),
    reshapePlanFeature: none('spends', DEV_SPENDS),
    seedPlan: none('setting', 'Fills an empty plan once.'),
    startOvernightRunner: none('spends', DEV_SPENDS),
    pauseOvernightRunner: none('spends', DEV_SPENDS),
    resumeOvernightRunner: none('spends', DEV_SPENDS),
    stopOvernightRunner: none('spends', DEV_SPENDS),
    addFeature: none('theirs', "A feature written ready is the person's say-so; add_step writes one for them to approve."),
    updateFeature: tool('reword'),
    sendScreenBack: none('theirs'),
    workPlanOverhaul: none('spends', DEV_SPENDS),
    setAutoApproveAction: none('setting'),
  },
  'app/dev/plan/run-actions.ts': {
    acknowledgePlanRunAction: none('theirs'),
    answerPlanRunAction: none('theirs'),
  },
  'app/dev/projects/actions.ts': {
    listRepositories: none('page'),
    addProject: tool('add_project'),
    archiveProject: none('theirs', 'Takes a project off the plan, which is the person\'s call about their own plan.'),
  },
  'app/dev/posts/actions.ts': {
    suggestPosts: none('spends', DEV_SPENDS),
    suggestPostAbout: none('spends', DEV_SPENDS),
    editPostBody: tool('rewrite_post'),
    markPostPosted: none('theirs', 'Says the person posted it; Dash never posts.'),
    promotePost: none('theirs', 'Moving a post between suggested and planned is the person deciding to write it.'),
    demotePost: none('theirs', 'Moving a post between suggested and planned is the person deciding to write it.'),
    dropPost: none('theirs'),
    restorePost: none('theirs'),
    writePost: none('own', 'A post the person wrote themselves.'),
    savePostWants: none('theirs', 'What the person wants from their posts is theirs to say.'),
    editPostAngle: none('own', "The person's say on what their post is about; the posts skill writes the first angle."),
    addPostImage: none('own', 'Attaches a picture the person uploaded from their device.'),
    removePostImage: none('deletes'),
    postToX: none('outside', 'Publishes under the person\'s name and spends on their X account, so it waits for their confirmed press.'),
    confirmXMatch: none('theirs'),
    dismissXMatch: none('theirs'),
    checkX: none('outside', 'Reads the account on X.'),
    disconnectX: none('account'),
  },
  'app/dev/raised/actions.ts': {
    decideRaise: none('theirs'),
    closeRaise: none('theirs'),
    dismissRaise: none('theirs'),
    reopenRaise: none('theirs'),
    markConversationRead: none('page'),
  },
  'app/dev/raised/check-back-actions.ts': {
    dropCheckBack: none('theirs'),
    restoreCheckBack: none('theirs', 'Undo: takes back their own drop.'),
  },
  'app/dev/specs/actions.ts': {
    saveModuleVision: none('theirs', "A vision is the person's and a session never edits one."),
    acceptVisionEdit: none('theirs'),
    dismissVisionEdit: none('theirs'),
    approveSpecChange: none('theirs'),
    declineSpecChange: none('theirs'),
    reopenVisionEdit: none('theirs', 'Undo: takes back their own decline.'),
    undeclineSpecChange: none('theirs', 'Undo: takes back their own decline.'),
  },
  'app/dev/specs/interview-actions.ts': {
    startInterview: none('spends', DEV_SPENDS),
    answerInterviewQuestion: none('theirs'),
    stopInterview: none('theirs'),
  },
  'app/dev/surfaces/actions.ts': {
    noteOnSurface: tool('file_note'),
  },
  'app/dev/ui/actions.ts': {
    removeTaste: none('setting'),
    restoreTaste: none('setting'),
  },
  'app/dev/ui/review/actions.ts': {
    startUiReview: none('spends', DEV_SPENDS),
    decideUiFinding: none('theirs'),
    confirmAllUiFindings: none('theirs'),
  },
  'app/dev/comment-actions.ts': {
    addComment: none('theirs'),
    deleteComment: none('deletes'),
  },
  'app/dev/ci-fix-action.ts': {
    sendCiFixToDash: none('spends', DEV_SPENDS),
  },
};
