import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/**
 * Why a Learn button that spends has no paid tool (plan #2228.4). The ones
 * that do are in lib/dash/paid-tools-learn.ts, queued for an approval.
 */
const PROPOSES =
  'Returns a proposal the page shows for the person to tick and approve, and keeps nothing, so a run from Dash would spend on a result no one sees.';
const STUDYING =
  'Writes a question, an answer or a mark for the person to work through as they study, on the page where they do; it means something only when they press it there.';
const IN_THE_ESSAY =
  'Works on the draft open in the essay editor, beside the paragraph or note being written; it is pressed while writing rather than asked for.';
const ON_A_CARD =
  'A press on one card in the Now deck, which marks that card tested; asked in words, Dash makes a subject with make_learn_subject.';
const OWNER_ONLY =
  "Only the app's owner can press it, since it spends the owner's YouTube quota and transcript credits.";
const CATALOGUE =
  'Writes the shared catalogue, which every account reads, through its own database connection rather than as the person.';

/**
 * What the Learn pages let the person do, and the tool that does each
 * (lib/agent-actions/types.ts). Most of Learn is the person studying, which
 * no agent does for them, or a model writing material, which costs money.
 * The changes an agent makes are lib/dash/learn-writes.ts (plan #1894.8).
 */
export const learnActions: ModuleActions = {
  'app/learn/c/[id]/actions.ts': {
    proposeBranch: none('spends', PROPOSES),
    approveBranch: none('theirs'),
    rewriteClaim: tool('reword_concept'),
    queueMaterial: none(
      'theirs',
      'Queues a section the catalogue found for the idea, which is the person taking a suggestion. Asked in words, Dash adds the work by its title and link with add_track_reading.',
    ),
    addConceptNote: tool('add_concept_note'),
  },
  'app/learn/topics/actions.ts': {
    draftTopicFromGoal: tool('draft_topic'),
  },
  'app/learn/topics/[id]/actions.ts': {
    mergeTopicDraft: none('theirs', 'Whether a draft duplicates a topic is the person’s call (LEARN-LEVELS-SPEC, "Drafting a topic").'),
    draftWantedTopic: {
      tool: 'draft_topic',
      note: 'Dash names the topic whose links want it as for_topic_id, and the levels that wanted it are linked to the draft.',
    },
    rewordLevel: none('theirs', 'What meeting a level of a topic means is the person’s to word (LEARN-LEVELS-SPEC, "Drafting a topic").'),
    markRowsPersonal: none('theirs', 'Dash marks an uncited row personal when it approves a draft (plan #2356.6); taking the mark off or putting it back is the person’s.'),
  },
  'app/learn/flow/theme-lens-actions.ts': {
    makeLensFromTheme: none('theirs', 'Whether a vault theme becomes a lens of its own is the person’s to say (plan #2138.14).'),
    declineLensFromTheme: none('theirs', 'Saying no to the offer of a lens is the person’s (plan #2138.14).'),
  },
  'app/learn/lens/[id]/actions.ts': {
    saveLensTargets: none('theirs', 'How far they want to go on each topic of a subject or goal is the person’s to say (LEARN-LEVELS-SPEC, "Lenses: subjects and goals").'),
  },
  'app/learn/topics/review/actions.ts': {
    moveClaimsSubject: none(
      'spends',
      "One subject for each call the page's Move makes as it works through every subject in turn, and the person answers its placements on the same page.",
    ),
    refreshMoveReview: none('page', 'Reloads the review page once a run of moves ends; changes nothing.'),
    answerMoveReview: none('theirs', 'Where an idea sits and whether a need between two ideas stands is the person’s call (LEARN-LEVELS-SPEC, "Migration from the claims graph").'),
  },
  'app/learn/b/[id]/actions.ts': {
    saveShortAnswer: none('own'),
    setBriefWatch: none('setting'),
    setBriefArchived: none('own'),
    retryBrief: tool('retry_research_brief'),
    startEssayOnBrief: none('own'),
    draftBriefTopics: none('theirs', 'Which goal a research brief feeds is the person’s to choose (plan #2184.1); the draft is approved as it is kept when every row cites a source (plan #2356.2).'),
  },
  'app/learn/clips/actions.ts': {
    loadMoreClipsAction: none('page'),
    clipShownAction: none('own'),
    clipFinishedAction: none('own'),
    clipSkippedAction: none('own'),
    clipSavedAction: none('own', "Saving a clip is the person's own reaction to what they watched, as finishing or skipping one is."),
    clipNotInterestedAction: none('own'),
  },
  'app/learn/essays/actions.ts': {
    startEssay: none('own'),
    startEssayFrom: none('own'),
  },
  'app/learn/e/[id]/actions.ts': {
    saveEssayDraft: none('own'),
    saveEssayBriefField: none('own'),
    setEssayWordTarget: none('setting'),
    finishEssay: none('own'),
    acceptEssayFinish: none('theirs'),
    saveEssayToVaultAction: none('own'),
    reloadEssayFromVault: none('page'),
    moveEssayNotes: none('page'),
    closeEssayNote: none('theirs'),
    reopenEssayNote: none('theirs', 'Undo: takes back their own Done or Decline.'),
    helpEssayNote: none('spends', IN_THE_ESSAY),
    hideEssayStudyItem: none('theirs'),
    findEssayStudy: none('page'),
    rephraseEssaySelection: none('spends', IN_THE_ESSAY),
    researchEssay: none('spends', IN_THE_ESSAY),
    runEssayCheck: none('spends', IN_THE_ESSAY),
    publishEssay: none('outside', "Publishes to the person's website."),
    unpublishEssay: none('outside'),
  },
  'app/learn/e/[id]/attached-actions.ts': {
    detachVaultNote: none('theirs', 'Takes a vault note off the essay; one Dash attached is taken off with its Undo on Home.'),
    searchEssayVaultNotes: none('page'),
  },
  'app/learn/e/[id]/bring-note-actions.ts': {
    previewVaultNoteInNotes: none('page'),
    addVaultNoteToNotes: none('own', "Adds a vault note's text to the essay's notes page, which is the person's own writing."),
  },
  'app/learn/e/[id]/notes-to-vault-actions.ts': {
    previewEssayNotesInVaultNote: none('page'),
    addEssayNotesToVaultNote: {
      tool: 'edit_vault_note',
      note: "Dash adds the essay's notes to the note with append.",
    },
  },
  'app/learn/e/[id]/guide-actions.ts': {
    changeEssayPlan: none('own'),
    updateNoteMap: none('spends', IN_THE_ESSAY),
    findClusterEvidence: none('spends', IN_THE_ESSAY),
    writeModelDraft: none('spends', IN_THE_ESSAY),
    logEssayView: none('page'),
  },
  'app/learn/flow/actions.ts': {
    answerTrackOffer: none('theirs'),
    takeBackOfferAnswer: none('theirs', 'Undo: takes back their own answer.'),
  },
  'app/learn/flow/cell-actions.ts': {
    answerCellQuestion: none('own'),
  },
  'app/learn/flow/summary-action.ts': {
    readRunSummary: none('page'),
  },
  'app/learn/now/piece-talk-actions.ts': {
    talkPiece: none('own'),
  },
  'app/learn/space/actions.ts': {
    saveRecordingAction: none('setting'),
  },
  'app/learn/space/pairs/actions.ts': {
    mergeIdeasAction: none('theirs', 'Whether two ideas are one is the person\'s call; closeness only found the pair.'),
    keepBothIdeasAction: none('theirs', 'Whether two ideas are one is the person\'s call; closeness only found the pair.'),
  },
  'app/learn/know/actions.ts': {
    proposeGoal: {
      tool: 'draft_topic',
      note: 'Naming a goal drafts its topic; named on a subject, Dash passes it as subject_id and the topic joins its lens.',
    },
    proposePrior: none('spends', PROPOSES),
    approvePrior: none('theirs'),
    proposeFromCourse: none('spends', PROPOSES),
    approveFromCourse: none('theirs'),
    proposeBrief: none('spends', PROPOSES),
    approveBrief: none('theirs'),
    proposeFromNote: none('spends', PROPOSES),
    createCustomTrack: {
      tool: 'make_learn_subject',
      note: 'Making a subject writes its curriculum and places it among the areas with a model. A reading list with no model run is add_learn_track.',
    },
  },
  'app/learn/know/move-actions.ts': {
    moveTheme: none('setting', 'Where a theme sits on the areas grid is how the person arranges their own map.'),
  },
  'app/learn/know/level3-actions.ts': {
    addLevel3Goal: none(
      'theirs',
      'Takes the ready-made Level 3 goal Subjects offers, which is the person accepting an offer. Asked for in words, Dash adds a goal with add_goal.',
    ),
  },
  'app/learn/lists/actions.ts': {
    startTrack: tool('add_learn_track'),
  },
  'app/learn/save/actions.ts': {
    saveReadingLink: {
      tool: 'add_track_reading',
      note: 'Dash adds the work by its title and link to a list it is told, where the page reads the title from the link and puts it on "Saved links".',
    },
  },
  'app/learn/now/actions.ts': {
    loadMoreCards: none('page'),
    openCardSource: none('page'),
    addCardNote: tool('add_concept_note'),
    deleteCardNote: none('deletes'),
    dismissCard: none('own'),
    rateCard: none('own'),
    swipeCard: none('own'),
    saveCard: none('own', "Saving a card is the person's own verdict on it, as a swipe or a rating is."),
    testMeOnCard: none('spends', ON_A_CARD),
    startTrackOffer: none('theirs'),
    makeTrackOfCard: none('spends', ON_A_CARD),
    askAboutCard: none('spends', STUDYING),
    explainPhrase: none('spends', STUDYING),
    makePhraseCard: none('spends', STUDYING),
    answerUnitCheck: none('own'),
    answerRestingTrack: none('theirs'),
    explainBack: none('own'),
    setTeachBackEvery: none('setting'),
  },
  'app/learn/opening/[id]/actions.ts': {
    answerOpening: none('own'),
    skipOpening: none('own'),
  },
  'app/learn/quiz/[id]/actions.ts': {
    writeQuestions: tool('write_quiz_questions'),
  },
  'app/learn/quiz/[id]/take/actions.ts': {
    answerQuiz: none('own'),
    skipQuiz: none('own'),
  },
  'app/learn/r/[id]/actions.ts': {
    findSources: none('spends', PROPOSES),
    attachSource: { tool: 'change_reading', note: 'Dash attaches the link it is given, where the page picks from a search.' },
    updateStatus: tool('change_reading'),
    toggleReadNow: tool('change_reading'),
    updateNote: tool('change_reading'),
    openReading: none('page'),
    readNoteIntoGraph: none('spends', PROPOSES),
    approveNoteConcepts: none('theirs'),
    goDeeper: none(
      'spends',
      'Opens one step of a route into a topic of its own and plans nothing; the spending is Plan this topic on the page it lands on, which proposes.',
    ),
    saveReadingText: tool('change_reading'),
    saveReadingPdf: { tool: 'change_reading', note: "Dash keeps the PDF's text, which is what an upload is read into." },
    clearReadingText: tool('change_reading'),
    summarizeReading: tool('summarize_reading'),
    addReadingComment: none('theirs'),
  },
  'app/learn/go/actions.ts': {
    nextSessionItem: none('spends', 'Writes whatever the next item of the learning session needs as it comes up; the person is in the session.'),
    markSessionLessonRead: none('own'),
    markSessionLevelLessonRead: none('own'),
    endSession: none('own'),
  },
  'app/learn/review/actions.ts': {
    askReview: none('spends', STUDYING),
    answerReview: none('own'),
  },
  'app/learn/s/[id]/actions.ts': {
    continuePreparation: none('spends', "Restarts a subject's preparation run, which spends on the person's account; the daily run also resumes them."),
    chooseDirection: none('spends', "The person picks a branch to go deeper on, which starts a branch preparation run."),
    dismissDirection: none('theirs', 'Holds the offer of a direction back until another thirty answers.'),
    readAboutConcept: none(
      'spends',
      'Lands the person on the reading it found for one idea of the graph, or the row already queued for it; the page it lands on is the result.',
    ),
    addSubjectSource: none('spends', CATALOGUE),
    findSubjectChannels: none('spends', OWNER_ONLY),
    archiveSubject: none('setting', 'Whether a subject stays in front of the person is theirs to choose; archiving is undone by restoring.'),
    restoreSubject: none('setting', 'Putting an archived subject back in front of the person is theirs to choose.'),
    deleteSubject: none('deletes'),
    writeTrackCurriculum: tool('write_subject_curriculum'),
    moveUnitInPlan: none('setting', "The order of a learning goal's units is how the person arranges their own plan."),
    removeUnitFromPlan: none('deletes'),
    addUnitToPlan: { tool: 'add_plan_unit', note: 'Each unit added is described by a model before it is kept.' },
  },
  'app/learn/s/[id]/p/[piece]/actions.ts': {
    writeLessonForPiece: none('spends', "Written as the piece's page opens on an idea with no lesson; no button presses it."),
    askPieceCheck: none('spends', STUDYING),
    answerPieceCheck: none('own'),
    writePiecePractice: none('spends', STUDYING),
    handInPractice: none('own'),
  },
  'app/learn/s/[id]/probe/actions.ts': {
    askQuestion: none('spends', STUDYING),
    answerQuestion: none('own'),
    markKnown: none('own'),
    findFloor: none('spends', PROPOSES),
    approveFloor: none('theirs'),
  },
  'app/learn/s/[id]/project-actions.ts': {
    writePlanProject: none('spends', STUDYING),
    handInPlanProject: none('own'),
  },
  'app/learn/t/[id]/actions.ts': {
    addToTrack: tool('add_track_reading'),
    removeFromTrack: none('deletes'),
    removeTrack: none('deletes'),
    planTrack: none('spends', PROPOSES),
    confirmPlan: none('theirs'),
    keepAreas: none('theirs'),
  },
  'app/learn/videos/actions.ts': {
    setWatchedAction: tool('change_video'),
    moveVideoAction: tool('change_video'),
  },
  'app/learn/youtube/actions.ts': {
    addChannelAction: none('spends', `${OWNER_ONLY} Following a channel lists it and queues its transcripts.`),
    relistChannelAction: none('spends', `${OWNER_ONLY} Listing a channel again queues its new transcripts.`),
    setAutoTranscribeAction: none('setting'),
    removeChannelAction: none('deletes'),
    unfollowSubjectChannelAction: none(
      'deletes',
      'Takes the channel out of the YouTube library when no other subject follows it.',
    ),
    transcribeVideoAction: none('spends', OWNER_ONLY),
    transcribePlaylistAction: none('spends', OWNER_ONLY),
    setWatchListPlaylistAction: none('setting'),
  },
  'app/learn/settings/actions.ts': {
    setGoalsOnly: none('setting'),
    setOfferSubjects: none('setting'),
    setTeachBackRate: none('setting'),
  },
  'app/learn/settings/external/actions.ts': {
    startExternalCheck: none('own', 'Pasting a published set to sit once is the person starting their own measurement.'),
    answerExternal: none('own', 'The answers are the person\'s own, given blind; marking one spends.'),
    skipExternal: none('own'),
  },
};
