import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { combineEstimates, loadCostRanges } from '@/lib/core/spend/estimate';
import type { OperationName } from '@/lib/core/spend/guesses';

/**
 * Which operations each paid press records, keyed by the server action it
 * calls.
 *
 * A key is the action's file and export, `app/learn/t/[id]/actions.ts#planTrack`,
 * so a test can find the function and follow it to the ledger writers
 * (paid-actions.test.ts, through action-graph.ts). An action that does
 * different paid work depending on which button sent it gets one key per
 * button, with the button after a colon: the flow's `flowStep` asks, answers
 * and starts offered tracks, and one hint for all three would price an answer
 * at the cost of writing a track.
 *
 * The same list prices the hint and is checked against the code, which is
 * what makes "pressing it records what the hint named" true rather than hoped:
 * a press may skip an operation (a floor added to a track that is already
 * placed writes no placement), but it records nothing the hint left out.
 *
 * Per-unit operations are listed without a count. The button knows how many
 * it is working on and passes that to the hint.
 *
 * Learn is filled in by plan #917; Jobs, Shopping, Vault and Dash's comment
 * replies by #918. News has two paid presses, Reload on the recommended
 * newsletters (#947) and sending a view when discussing a story (#1060); its
 * summaries and story groups are made by the digest cron when an issue
 * arrives.
 */
export const PAID_ACTIONS = {
  // Learn: a track and its ideas
  // Naming a goal drafts its topic since the claims graph moved (plan #2138.4).
  'app/learn/know/actions.ts#proposeGoal': ['draft-topic', 'embed-topic-scope'],
  // Learn: a topic with ten levels (plan #2138.2). Drafting embeds the scope
  // in the same press to find a topic it duplicates; a topic the draft's links
  // need is drafted the same way.
  'app/learn/topics/actions.ts#draftTopicFromGoal': ['draft-topic', 'embed-topic-scope'],
  'app/learn/topics/[id]/actions.ts#draftWantedTopic': ['draft-topic', 'embed-topic-scope'],
  // Moving one subject from the claims graph (plan #2138.4): the call placing
  // its ideas, and each topic it names that the map lacks, drafted and embedded.
  'app/learn/topics/review/actions.ts#moveClaimsSubject': ['assign-topics', 'draft-topic', 'embed-topic-scope'],
  'app/learn/know/actions.ts#proposePrior': ['concepts-from-prior'],
  'app/learn/know/actions.ts#approvePrior': ['place-track'],
  'app/learn/know/actions.ts#proposeBrief': ['concepts-from-brief'],
  'app/learn/know/actions.ts#approveBrief': ['place-track'],
  'app/learn/know/actions.ts#proposeFromNote': ['classify-note', 'concepts-from-brief'],
  'app/learn/know/actions.ts#proposeFromCourse': ['concepts-from-course'],
  'app/learn/know/actions.ts#approveFromCourse': ['place-track'],
  // Learn: an essay's interview, one question per answer (plan #1867)
  'app/learn/e/[id]/actions.ts#answerEssayInterview': ['word-essay-question', 'read-essay-brief'],
  // Learn: Rephrase on a selection in an essay (plan #1868)
  'app/learn/e/[id]/actions.ts#rephraseEssaySelection': ['rephrase-essay-selection'],
  // Learn: Try again on a research brief whose run failed (plan #2023.4)
  'app/learn/b/[id]/actions.ts#retryBrief': ['research-topic'],
  // Learn: Summarize and Redo on a reading's page (plan #1876.4)
  'app/learn/r/[id]/actions.ts#summarizeReading': ['summarize-reading'],
  // Learn: a question in the chat on a reading's page (plan #1876.5)
  'app/learn/r/[id]/actions.ts#addReadingComment': ['reply-about-card'],
  // Learn: a named check on an essay, one call per paragraph it reads (plan
  // #1869). Already Said also finds your notes nearest each paragraph.
  'app/learn/e/[id]/actions.ts#runEssayCheck:model': ['check-essay-paragraph'],
  'app/learn/e/[id]/actions.ts#runEssayCheck:already-said': ['check-essay-paragraph', 'embed-note-match'],
  // Learn: the study panel searches with the paragraph you are writing after
  // a pause, and the interview with the brief (plan #1863.8). One embedding,
  // cached, so a paragraph searched before costs nothing.
  'app/learn/e/[id]/actions.ts#findEssayStudy': ['embed-note-match'],
  // Learn: research on an essay (plan #1863.9), one button per level. The
  // first pass searches the question; the deeper pass gathers pages and
  // marks the draft's claims against them.
  'app/learn/e/[id]/actions.ts#researchEssay:first': ['research-essay-question', 'write-essay-research'],
  // Learn: the guided essay's stages (LEARN-ESSAYS-SPEC, "The stages").
  // Answering the interview's last question also has Dash read the brief.
  'app/learn/e/[id]/guide-actions.ts#readEssayBrief': ['read-essay-brief'],
  'app/learn/e/[id]/guide-actions.ts#findEssayPoints': ['find-essay-points'],
  'app/learn/e/[id]/guide-actions.ts#shapeEssayPlan': ['shape-essay-plan'],
  'app/learn/e/[id]/guide-actions.ts#reviewEssayPlan': ['review-essay-plan'],
  'app/learn/e/[id]/guide-actions.ts#askEssayPoint': ['word-point-question'],
  'app/learn/e/[id]/guide-actions.ts#answerEssayPoint': ['word-point-question'],
  'app/learn/e/[id]/actions.ts#researchEssay:deeper': ['gather-essay-sources', 'judge-essay-claims'],
  // Learn: Finish on an essay names the claims it argues and looks for the
  // notes that already hold each (plan #1873). Accepting the offers writes
  // notes and an evidence item and calls no model.
  'app/learn/e/[id]/actions.ts#finishEssay': ['name-essay-claims', 'embed-note-match'],
  // Saving a personality result has Dash read it against your notes once the
  // page has answered (plan #1635); the button under the read asks again.
  'app/you/personality/actions.ts#saveBigFiveAction': ['read-personality', 'embed-note-match'],
  'app/you/personality/actions.ts#saveTypedAction': ['read-personality', 'embed-note-match'],
  'app/you/personality/actions.ts#readAgainAction': ['read-personality', 'embed-note-match'],
  'app/learn/know/actions.ts#createCustomTrack': ['place-track', 'write-curriculum'],
  'app/learn/c/[id]/actions.ts#proposeBranch': ['branch-from-selection'],
  'app/learn/c/[id]/actions.ts#approveBranch': ['place-track'],
  'app/learn/s/[id]/actions.ts#writeTrackCurriculum': ['write-curriculum'],
  'app/learn/s/[id]/actions.ts#addUnitToPlan': ['write-curriculum'],
  'app/learn/s/[id]/actions.ts#readAboutConcept': ['embed-claim', 'judge-segment'],
  'app/learn/s/[id]/actions.ts#pullWikipediaArticles': ['embed-catalogue'],
  'app/learn/s/[id]/actions.ts#pullLectureCourse': ['embed-catalogue'],
  'app/learn/s/[id]/actions.ts#findSubjectChannels': ['find-channels', 'judge-channel'],
  'app/learn/now/actions.ts#testMeOnCard': ['generate-chain', 'place-track'],
  'app/learn/now/actions.ts#startTrackOffer': [
    'generate-track-from-theme',
    'place-track',
    'write-curriculum',
  ],
  'app/learn/now/actions.ts#makeTrackOfCard': ['place-track', 'write-curriculum'],
  'app/learn/now/actions.ts#answerUnitCheck': ['mark-unit-check'],
  'app/learn/now/actions.ts#askAboutCard': ['reply-about-card'],
  'app/learn/now/actions.ts#explainPhrase': ['explain-phrase'],
  'app/learn/now/actions.ts#makePhraseCard': ['write-asked-card'],
  'app/learn/now/actions.ts#explainBack': ['mark-teach-back'],

  // Learn: questions
  'app/learn/s/[id]/p/[piece]/actions.ts#askPieceCheck': ['write-piece-check'],
  'app/learn/s/[id]/p/[piece]/actions.ts#answerPieceCheck': ['mark-piece-check'],
  'app/learn/s/[id]/p/[piece]/actions.ts#writePiecePractice': ['write-piece-practice'],
  'app/learn/s/[id]/p/[piece]/actions.ts#handInPractice': ['mark-piece-practice'],
  'app/learn/s/[id]/project-actions.ts#writePlanProject': ['write-plan-project'],
  'app/learn/s/[id]/project-actions.ts#handInPlanProject': ['mark-plan-project'],
  'app/learn/review/actions.ts#askReview': ['write-review-question'],
  'app/learn/review/actions.ts#answerReview': ['mark-review-question'],
  'app/learn/s/[id]/probe/actions.ts#askQuestion': ['write-probe', 'write-applied-case'],
  'app/learn/s/[id]/probe/actions.ts#answerQuestion': ['name-misconception', 'grade-applied-answer'],
  'app/learn/s/[id]/probe/actions.ts#findFloor': ['propose-floor'],
  'app/learn/s/[id]/probe/actions.ts#approveFloor': ['place-track'],
  'app/learn/flow/actions.ts#flowStep:ask': ['write-probe'],
  'app/learn/flow/actions.ts#flowStep:answer': ['name-misconception', 'grade-applied-answer'],
  'app/learn/flow/actions.ts#flowStep:start-track': [
    'generate-track-from-theme',
    'place-track',
    'write-probe',
  ],
  // Learn: an explanation graded against the levels of a topic (plan #2138.5)
  'app/learn/flow/cell-actions.ts#answerCellQuestion': ['grade-cell-answer'],
  'app/learn/opening/[id]/actions.ts#answerOpening': ['grade-opening-answer'],
  'app/learn/quiz/[id]/actions.ts#writeQuestions': ['write-quiz-questions'],
  'app/learn/quiz/[id]/take/actions.ts#answerQuiz': ['grade-quiz-answer'],

  // Learn: reading lists
  'app/learn/t/[id]/actions.ts#planTrack': ['plan-topic', 'name-areas'],
  'app/learn/r/[id]/actions.ts#findSources': ['suggest-sources'],
  'app/learn/r/[id]/actions.ts#openReading': ['locate-passage'],
  'app/learn/r/[id]/actions.ts#readNoteIntoGraph': ['concepts-from-note', 'judge-note-concepts'],
  'app/learn/r/[id]/actions.ts#approveNoteConcepts': ['place-track'],
  'app/learn/youtube/actions.ts#transcribeVideoAction': ['embed-catalogue'],
  'app/learn/youtube/actions.ts#transcribePlaylistAction': ['embed-catalogue'],

  // Jobs
  'app/jobs/(app)/companies/actions.ts#proposeAiCompanyEnrichment': ['enrich-company'],
  'app/jobs/(app)/roles/[id]/posting-actions.ts#matchRoleRequirements': ['match-evidence'],
  'app/jobs/(app)/roles/[id]/prep-actions.ts#writeRoundPrepNote': ['write-interview-prep'],
  // Dash's reply to a comment on a role that tags it, and the letter it writes
  'app/jobs/(app)/roles/[id]/comment-actions.ts#addRoleComment': ['reply-to-role-comment'],
  // Asks on the role's thread, as a comment tagged @dash does.
  'app/jobs/(app)/_home/prepare-actions.ts#prepareWithDash': ['reply-to-role-comment'],
  'app/jobs/(app)/roles/actions.ts#draftAnswerFromEvidence': ['draft-answer'],
  'app/jobs/(app)/material/evidence-actions.ts#proposeEvidence': ['propose-evidence'],
  'app/jobs/(app)/find/actions.ts#findStartups': ['shortlist-startups'],
  'app/jobs/(app)/find/recommend-actions.ts#suggestPeople': ['suggest-outreach'],
  'app/jobs/(app)/find/recommend-actions.ts#suggestOpenings': ['find-openings', 'score-openings'],

  // Shopping
  'app/shopping/sell/actions.ts#priceSellItems': ['estimate-resale-price'],
  'app/shopping/sell/actions.ts#priceOneItem': ['estimate-resale-price'],
  'app/shopping/sell/actions.ts#searchItemPrice': ['estimate-resale-price'],
  'app/shopping/settings/actions.ts#reparseInboxOrders': ['extract-email-order'],
  // Not an action: "Import orders from Gmail" and "Sync now" in Shopping
  // settings post here, and the import reads each order confirmation it finds.
  'app/api/inbox/sync/route.ts#POST': ['extract-email-order'],
  // "Add from this email" on the review list reads the confirmation and makes
  // the order in one press (plan #1950.3.3), through the aimed capture.
  'app/capture-actions.ts#makeAimedCapture:email': ['extract-email-order'],

  // Vault
  'app/vault/n/[...path]/actions.ts#proposeMap': ['map-note', 'embed-map'],
  'app/vault/n/[...path]/actions.ts#acceptMap': ['embed-map'],
  'app/vault/n/[...path]/actions.ts#askMaya': ['write-maya-thought'],
  'app/vault/maya/actions.ts#replyToMaya': ['reply-to-maya'],
  'app/you/work/actions.ts#readTranscriptAction': ['read-transcript'],
  'app/you/work/job-actions.ts#readResumeAction': ['read-work-history'],

  // Dev: Dash's reply to a comment that tags it
  'app/dev/comment-actions.ts#addComment': ['reply-to-comment'],
  'app/dev/raised/actions.ts#decideRaise': ['reply-to-comment'],
  // Any other thread, a file's first (plan #1441): Dash's reply when tagged
  'app/thread-actions.ts#addRowComment': ['reply-to-comment'],

  // News: making the list of recommended newsletters. The view also presses
  // this once on its own, the first time it opens with no list stored.
  'app/news/all/actions.ts#remakeRecommendations': ['recommend-newsletters'],
  // News: Dash's reply in a discussion of a Quick read story
  'app/news/quick/actions.ts#discussQuickStory': ['discuss-story'],

  // The one capture box, on every page (plan #1581): Enter files what was
  // typed, sorting it first when no guess had come back, and a goal update
  // goes through Goals' own filing.
  'app/capture-actions.ts#fileCaptureBox': ['place-capture', 'file-capture'],
  // An Add button aimed at an order (plan #1950.3.1): the sentence is read as
  // an order before it is made.
  'app/capture-actions.ts#makeAimedCapture': ['read-order-sentence'],
  // The same press with a receipt photo taken in the panel (plan #1950.3.2):
  // the photo is read as the order instead of the sentence.
  'app/capture-actions.ts#makeAimedCapture:receipt': ['read-receipt-photo'],
  // An Add button aimed at a goal (plan #1950.5): one in the Learn area is
  // placed and given a plan after the response (plan #1490), as one added
  // from the old New goal form was.
  'app/capture-actions.ts#makeAimedCapture:goal': ['place-aim', 'write-curriculum'],
  // The header's notes button (plan #1950.5): the note is triaged once it
  // has saved (plan #1179), as it was from the old popover.
  'app/capture-actions.ts#makeAimedCapture:dev-note': ['triage-note'],

  // Goals: filing a sentence from the capture box, on every page
  'app/goals/capture-actions.ts#fileGoalCapture': ['file-capture'],
  // Goals: reading pasted text or a document into an information step's form
  'app/goals/[goalId]/document-actions.ts#readIntoFormAction': ['read-into-form'],
  // Goals: Dash's reply to a comment on a goal or a step that tags it
  'app/goals/[goalId]/comment-actions.ts#addGoalComment': ['reply-to-goal-comment'],
  // Goals: Ask Dash on the Goals home, which is the same @dash comment on a goal
  'app/goals/home-actions.ts#askDashAction': ['reply-to-goal-comment'],
  // A new goal from Ask Dash in the Learn area is placed and given a plan, as
  // Add goal's is (plan #1490). The hint shows for that area alone.
  'app/goals/home-actions.ts#askDashAction:new-goal': ['place-aim', 'write-curriculum'],

  // Dash: a question about anything in the app, from the sheet in the shell,
  // ⌘K or /ask (plan #1090), streaming its lookups as they run (plan #1438)
  'app/api/ask/route.ts#POST': ['ask-dash'],
  // Dash's interview on the specs page (plan #1641): a question each press,
  // and the vision and spec drafted from the answers at the end
  'app/dev/specs/interview-actions.ts#startInterview': ['ask-dash'],
  'app/dev/specs/interview-actions.ts#answerInterviewQuestion': ['ask-dash'],

  // Timeline: writing a year up, or the current year again (plan #1121)
  'app/timeline/actions.ts#writeYearReview': ['write-year-review'],
} as const satisfies Record<string, readonly OperationName[]>;

export type PaidAction = keyof typeof PAID_ACTIONS;

/**
 * Paid actions no button sends, so there is nowhere to put a hint, each with
 * why. paid-actions.test.ts accepts these and nothing else.
 */
export const PAID_WITHOUT_BUTTON: Record<string, string> = {
  'app/api/cron/daily/route.ts#GET':
    'The one daily cron, fired by Vercel. Its paid stage is the weekly check of research briefs for new sources (plan #2023.8), two web searches a brief, which runs only for briefs whose "Check every week" switch was turned on; no press starts it.',
  'app/learn/now/actions.ts#generateSubjectCards':
    "Generate more on an empty subject's Now (note 43b8d7ac). It writes the subject's next lessons while the person waits, the same top-up loading more starts after the response, so what it spends is the top-up's background operations, which a hint does not name; the spend page lists them under the lessons. Its one foreground cost is the related-notes embedding loading the cards makes, as for loadMoreCards.",
  'app/you/personality/actions.ts#restoreTypedAction':
    'The undo after deleting a typed-in personality type. It saves through the same path as Save, but with the read turned off, so it spends nothing (plan #1635).',
  'app/dev/bugs/actions.ts#triageFiled':
    'Triage of a note or idea already saved, showing its type, workspace, priority and any open item it repeats (plan #1179), and scoring an idea against the vision of its workspace (plan #1327). The header panel that called it is gone (plan #1950.5): a note filed through capture is triaged after it saves, priced under app/capture-actions.ts#makeAimedCapture:dev-note. There is no button of its own.',
  'app/goals/capture-actions.ts#sortGoalCapture':
    'Called by the capture box when typing pauses, to guess what the sentence will do (plan #1177). There is no button, only the field; the File it hint prices the filing.',
  'app/capture-actions.ts#sortCaptureBox':
    'Called by the one capture box when typing pauses, to say where the sentence will go (plan #1581). There is no button, only the field; the File it hint prices it under app/capture-actions.ts#fileCaptureBox.',
  'app/goals/actions.ts#editGoal':
    'Saved when a goal\'s title or done-when loses focus after a change, or when it is moved to another area. Only a goal in the Learn area costs: it is placed again and, if it has no plan yet, given one (plan #1490). There is no button, only the field.',
  'app/api/inbox/sync/continue/route.ts#POST':
    'The sync calling itself to carry on past one invocation, authenticated by a token rather than a session. The press that started it is "Sync now", whose hint is under app/api/inbox/sync/route.ts#POST and prices each email.',
  'app/api/review/reread-confirmations/route.ts#GET':
    'A diagnostic opened by URL on the deployed site to count what the order reader gets from waiting confirmations (plan #830). Nothing links to it.',
  'app/api/cron/startup-discovery/route.ts#GET':
    'Fired on Mondays by pg_cron to shortlist startups for the job search; the Find startups button on Find makes the same call under app/jobs/(app)/find/actions.ts#findStartups.',
  'app/api/cron/startup-discovery/route.ts#POST':
    'Fired on Mondays by pg_cron to shortlist startups for the job search; the Find startups button on Find makes the same call under app/jobs/(app)/find/actions.ts#findStartups.',
  'app/api/cron/theme-placement/route.ts#GET':
    'Fired every hour by pg_cron to place vault themes and Learn subjects in the areas, and to look up where to read readings added from a chat whose lookup did not run after the reply (plan #1806, #1810); no press starts it.',
  'app/api/cron/theme-placement/route.ts#POST':
    'Fired every hour by pg_cron to place vault themes and Learn subjects in the areas, and to look up where to read readings added from a chat whose lookup did not run after the reply (plan #1806, #1810); no press starts it.',
  'app/api/cron/maya-gate/route.ts#GET':
    'Fired every hour by pg_cron to ask Jev about new vault notes and have Maya write on a few; no press starts it.',
  'app/api/cron/maya-gate/route.ts#POST':
    'Fired every hour by pg_cron to ask Jev about new vault notes and have Maya write on a few; no press starts it.',
  'app/api/cron/map-sweep/route.ts#GET':
    'Fired every five minutes by pg_cron to work the vault\'s map sweep; no press starts it.',
  'app/api/cron/map-sweep/route.ts#POST':
    'Fired every five minutes by pg_cron to work the vault\'s map sweep; no press starts it.',
  'app/api/cron/note-connections/route.ts#GET':
    'Fired on Mondays by pg_cron to write the week\'s connections between new and older vault notes; no press starts it.',
  'app/api/cron/note-connections/route.ts#POST':
    'Fired on Mondays by pg_cron to write the week\'s connections between new and older vault notes; no press starts it.',
  'app/api/cron/observations/route.ts#GET':
    'Fired on Mondays by pg_cron to write the week\'s observations across the modules; no press starts it.',
  'app/api/cron/observations/route.ts#POST':
    'Fired on Mondays by pg_cron to write the week\'s observations across the modules; no press starts it.',
  'app/api/cron/year-review/route.ts#GET':
    'Fired on 2 January by pg_cron to write the year just gone for everyone with events in it; no press starts it.',
  'app/api/cron/year-review/route.ts#POST':
    'Fired on 2 January by pg_cron to write the year just gone for everyone with events in it; no press starts it.',
  'app/api/cron/day-brief/route.ts#GET':
    'Fired every hour by pg_cron to write the morning brief for whoever it is six to eleven in the morning for; no press starts it.',
  'app/api/cron/day-brief/route.ts#POST':
    'Fired every hour by pg_cron to write the morning brief for whoever it is six to eleven in the morning for; no press starts it.',
  'app/api/cron/week-review/route.ts#GET':
    'Fired once on Sunday at 14:11 UTC by pg_cron to write the review of the week just gone; no press starts it.',
  'app/api/cron/week-review/route.ts#POST':
    'Fired once on Sunday at 14:11 UTC by pg_cron to write the review of the week just gone; no press starts it.',
  'app/api/cron/youtube-library/route.ts#GET':
    'Fired four times a day by pg_cron to fetch and embed the YouTube library\'s transcripts; no press starts it.',
  'app/api/cron/youtube-library/route.ts#POST':
    'Fired four times a day by pg_cron to fetch and embed the YouTube library\'s transcripts; no press starts it.',
  'app/api/cron/job-suggestions/route.ts#GET':
    'Fired daily by pg_cron; writes people to meet every three days and roles once a week, for each account whose lists are short. The search presses on Find are priced under app/jobs/(app)/find/recommend-actions.ts.',
  'app/api/cron/job-suggestions/route.ts#POST':
    'Fired daily by pg_cron; writes people to meet every three days and roles once a week, for each account whose lists are short. The search presses on Find are priced under app/jobs/(app)/find/recommend-actions.ts.',
  'app/api/cron/job-openings/route.ts#GET':
    'Fired daily by pg_cron to read each open recommended role from its link and score the new ones with Jev; no press starts it.',
  'app/api/cron/job-openings/route.ts#POST':
    'Fired daily by pg_cron to read each open recommended role from its link and score the new ones with Jev; no press starts it.',
  'app/api/cron/job-search-batches/route.ts#GET':
    'Fired every ten minutes by pg_cron to finish the roles and people searches that went on as Message Batches, then read and score the new roles; the press that queued them is priced under app/jobs/(app)/find/recommend-actions.ts.',
  'app/api/cron/job-search-batches/route.ts#POST':
    'Fired every ten minutes by pg_cron to finish the roles and people searches that went on as Message Batches, then read and score the new roles; the press that queued them is priced under app/jobs/(app)/find/recommend-actions.ts.',
  'app/learn/now/actions.ts#loadMoreCards':
    'Called by the Learn now deck on its own while four cards are still ahead, to load the next few; no press starts it. The paid part is matching a card with no stored concept vector to your vault notes (plan #1113), one short embedding per card, paid once, since the vector is kept by the text\'s hash.',
};

/** Every paid press, in the order written. */
export const PAID_ACTION_KEYS = Object.keys(PAID_ACTIONS) as PaidAction[];

/** The operations a press records. */
export function paidOperations(action: PaidAction): readonly OperationName[] {
  return PAID_ACTIONS[action];
}

/** The server action a key names: its file and export, without the button. */
export function actionOf(key: string): { file: string; name: string } {
  const [file, rest = ''] = key.split('#');
  return { file: file!, name: rest.split(':')[0]! };
}

/** One estimate per press, for what a layout hands its hints. */
export type PaidCosts = Partial<Record<PaidAction, CostEstimate>>;

/**
 * The estimate for each of `actions`, from one read of the ledger.
 *
 * A layout calls this for its module's presses and hands the result to
 * `PaidCostsProvider` (components/ui/paid-hint.tsx), so every hint on every
 * page under it reads its figure without asking the server again.
 */
export async function estimatePaidActions(
  supabase: CoreSupabaseClient,
  userId: string,
  actions: readonly PaidAction[],
): Promise<PaidCosts> {
  const ranges = await loadCostRanges(
    supabase,
    userId,
    actions.flatMap((action) => PAID_ACTIONS[action]),
  );
  const costs: PaidCosts = {};
  for (const action of actions) {
    const estimate = combineEstimates(PAID_ACTIONS[action], ranges);
    if (estimate) costs[action] = estimate;
  }
  return costs;
}

/** The presses whose action lives under `prefix`, such as `app/learn/`. */
export function paidActionsUnder(prefix: string): PaidAction[] {
  return PAID_ACTION_KEYS.filter((key) => key.startsWith(prefix));
}
