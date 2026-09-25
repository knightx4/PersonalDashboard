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
 * replies by #918. News has one paid button, Reload on the recommended
 * newsletters (#947); its summaries and story groups are made by the digest
 * cron when an issue arrives.
 */
export const PAID_ACTIONS = {
  // Learn: a track and its ideas
  'app/learn/know/actions.ts#proposeGoal': [
    'name-opening-claims',
    'write-opening-question',
    'generate-chain',
  ],
  'app/learn/know/actions.ts#approveChain': ['place-track', 'write-curriculum'],
  'app/learn/know/actions.ts#proposePrior': ['concepts-from-prior'],
  'app/learn/know/actions.ts#approvePrior': ['place-track'],
  'app/learn/know/actions.ts#proposeBrief': ['concepts-from-brief'],
  'app/learn/know/actions.ts#approveBrief': ['place-track'],
  'app/learn/know/actions.ts#proposeFromNote': ['classify-note', 'concepts-from-brief'],
  'app/learn/know/actions.ts#createCustomTrack': ['place-track', 'write-curriculum'],
  'app/learn/c/[id]/actions.ts#proposeBranch': ['branch-from-selection'],
  'app/learn/c/[id]/actions.ts#approveBranch': ['place-track'],
  'app/learn/s/[id]/actions.ts#writeTrackCurriculum': ['write-curriculum'],
  'app/learn/s/[id]/actions.ts#readAboutConcept': ['embed-claim', 'judge-segment'],
  'app/learn/s/[id]/actions.ts#pullWikipediaArticles': ['embed-catalogue'],
  'app/learn/s/[id]/actions.ts#pullLectureCourse': ['embed-catalogue'],
  'app/learn/goals/actions.ts#addGoal': ['place-aim'],
  'app/learn/now/actions.ts#testMeOnCard': ['generate-chain', 'place-track'],
  'app/learn/now/actions.ts#startTrackOffer': [
    'generate-track-from-theme',
    'place-track',
    'write-curriculum',
  ],
  'app/learn/now/actions.ts#makeTrackOfCard': ['place-track', 'write-curriculum'],

  // Learn: questions
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
  'app/learn/opening/[id]/actions.ts#answerOpening': ['grade-opening-answer'],
  'app/learn/quiz/[id]/actions.ts#writeQuestions': ['write-quiz-questions'],
  'app/learn/quiz/[id]/take/actions.ts#answerQuiz': ['grade-quiz-answer'],

  // Learn: reading lists
  'app/learn/new/actions.ts#parseImport': ['parse-references'],
  'app/learn/new/actions.ts#resolveCandidate': ['resolve-reference'],
  'app/learn/t/[id]/actions.ts#planTrack': ['plan-topic', 'name-areas'],
  'app/learn/r/[id]/actions.ts#findSources': ['suggest-sources'],
  'app/learn/r/[id]/actions.ts#openReading': ['locate-passage'],
  'app/learn/r/[id]/actions.ts#readNoteIntoGraph': ['concepts-from-note'],
  'app/learn/r/[id]/actions.ts#approveNoteConcepts': ['place-track'],
  'app/learn/youtube/actions.ts#transcribeVideoAction': ['embed-catalogue'],
  'app/learn/youtube/actions.ts#transcribePlaylistAction': ['embed-catalogue'],

  // Jobs
  'app/jobs/(app)/companies/actions.ts#proposeAiCompanyEnrichment': ['enrich-company'],
  'app/jobs/(app)/roles/[id]/actions.ts#matchRoleRequirements': ['match-evidence'],
  'app/jobs/(app)/roles/[id]/actions.ts#writeRoundPrepNote': ['write-interview-prep'],
  'app/jobs/(app)/roles/actions.ts#draftAnswerFromEvidence': ['draft-answer'],
  'app/jobs/(app)/settings/evidence-actions.ts#proposeEvidence': ['propose-evidence'],

  // Shopping
  'app/shopping/inventory/add/actions.ts#previewPasteBookList': ['parse-paste-list'],
  'app/shopping/inventory/add/games/actions.ts#extractGamesFromPhoto': ['read-shelf-photo'],
  'app/shopping/inventory/add/photo-actions.ts#extractBooksFromPhoto': ['read-book-photo'],
  'app/shopping/orders/receipt/actions.ts#previewReceiptPhoto': ['read-receipt-photo'],
  'app/shopping/sell/actions.ts#priceSellItems': ['estimate-resale-price'],
  'app/shopping/sell/actions.ts#priceOneItem': ['estimate-resale-price'],
  'app/shopping/sell/actions.ts#searchItemPrice': ['estimate-resale-price'],
  'app/shopping/settings/actions.ts#reparseInboxOrders': ['extract-email-order'],
  // Not an action: "Import orders from Gmail" and "Sync now" in Shopping
  // settings post here, and the import reads each order confirmation it finds.
  'app/api/inbox/sync/route.ts#POST': ['extract-email-order'],
  // Not an action either: "Add from this email" on the review list opens this page,
  // which reads the confirmation into the order form as it renders.
  'app/shopping/orders/new/page.tsx#NewOrderPage': ['extract-email-order'],

  // Vault
  'app/vault/n/[...path]/actions.ts#proposeMap': ['map-note', 'embed-map'],
  'app/vault/n/[...path]/actions.ts#acceptMap': ['embed-map'],

  // Dev: Dash's reply to a comment that tags it
  'app/dev/comment-actions.ts#addComment': ['reply-to-comment'],
  'app/dev/raised/actions.ts#decideRaise': ['reply-to-comment'],

  // News: making the list of recommended newsletters. The view also presses
  // this once on its own, the first time it opens with no list stored.
  'app/news/all/actions.ts#remakeRecommendations': ['recommend-newsletters'],

  // Goals: filing a sentence from the capture box, on every page
  'app/goals/capture-actions.ts#fileGoalCapture': ['file-capture'],
  // Goals: reading pasted text or a document into an information step's form
  'app/goals/[goalId]/document-actions.ts#readIntoFormAction': ['read-into-form'],
  // Goals: Dash's reply to a comment on a goal or a step that tags it
  'app/goals/[goalId]/comment-actions.ts#addGoalComment': ['reply-to-goal-comment'],
} as const satisfies Record<string, readonly OperationName[]>;

export type PaidAction = keyof typeof PAID_ACTIONS;

/**
 * Paid actions no button sends, so there is nowhere to put a hint, each with
 * why. paid-actions.test.ts accepts these and nothing else.
 */
export const PAID_WITHOUT_BUTTON: Record<string, string> = {
  'app/learn/goals/actions.ts#editGoal':
    'Saved when a goal\'s name or line loses focus after a change, and a reworded goal is placed again (place-aim). There is no button, only the field.',
  'app/shopping/review/actions.ts#readOrderFromEmail':
    'Nothing calls it. "Add from this email" on the review list opens the order form, whose page makes the same read as it renders, so the hint sits on that link under app/shopping/orders/new/page.tsx#NewOrderPage.',
  'app/api/inbox/sync/continue/route.ts#POST':
    'The sync calling itself to carry on past one invocation, authenticated by a token rather than a session. The press that started it is "Sync now", whose hint is under app/api/inbox/sync/route.ts#POST and prices each email.',
  'app/api/review/reread-confirmations/route.ts#GET':
    'A diagnostic opened by URL on the deployed site to count what the order reader gets from waiting confirmations (plan #830). Nothing links to it.',
  'app/api/cron/map-sweep/route.ts#GET':
    'Fired every five minutes by pg_cron to work the vault\'s map sweep; no press starts it.',
  'app/api/cron/map-sweep/route.ts#POST':
    'Fired every five minutes by pg_cron to work the vault\'s map sweep; no press starts it.',
  'app/api/cron/youtube-library/route.ts#GET':
    'Fired four times a day by pg_cron to fetch and embed the YouTube library\'s transcripts; no press starts it.',
  'app/api/cron/youtube-library/route.ts#POST':
    'Fired four times a day by pg_cron to fetch and embed the YouTube library\'s transcripts; no press starts it.',
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
