/**
 * Every Claude model id the app calls, in one place (plan #1464).
 *
 * Changing which model a part of the app uses is a one-line change here: each
 * call site reads its entry in `MODELS` by name, and no other file spells a
 * model id (lib/core/models.test.ts checks that). The four tiers below are the
 * only strings; the entries name a tier.
 *
 * The dated Haiku id is the same model as the Haiku alias. The call sites
 * that were pinned to it keep it, so the ids recorded in the spend ledger
 * stay as they were.
 */

export const OPUS = 'claude-opus-5';
export const SONNET = 'claude-sonnet-5';
export const HAIKU = 'claude-haiku-4-5';
export const HAIKU_DATED = 'claude-haiku-4-5-20251001';

/** The model each call site uses, keyed by what the call does. Grouped by the file that makes it. */
export const MODELS = {
  /** lib/dash/ask.ts, Ask Dash; the same model as `talk` today */
  dashAsk: SONNET,
  /** app/shopping/inventory/add/photo-actions.ts */
  shoppingBookPhoto: HAIKU_DATED,
  /** inngest/dev/suggest.ts */
  devDigestSuggest: HAIKU,
  /** lib/books/paste-list.ts */
  booksPasteList: HAIKU_DATED,
  /** lib/books/receipt-photo.ts */
  booksReceiptPhoto: HAIKU_DATED,
  /** lib/comments/reply.ts */
  devCommentReply: HAIKU,
  /** lib/day-brief/model.ts */
  dayBrief: HAIKU,
  /** lib/dev/inspiration/merge.ts */
  inspirationMerge: HAIKU,
  /** lib/dev/inspiration/summary.ts */
  inspirationSummary: HAIKU,
  /** lib/dev/inspiration/takeaways.ts */
  inspirationTakeaways: SONNET,
  /** lib/drafts/model.ts */
  drafts: SONNET,
  /** lib/email/extract/extract-order.ts */
  emailOrderExtract: HAIKU_DATED,
  /** lib/games/shelf-photo.ts */
  gamesShelfPhoto: OPUS,
  /** lib/goals/capture-model.ts */
  goalCapture: HAIKU,
  /** lib/goals/comment-model.ts */
  goalCommentReply: HAIKU,
  /** lib/goals/extract-model.ts */
  goalExtract: HAIKU,
  /** lib/goals/hold-acts-model.ts */
  goalHoldActs: HAIKU,
  /** lib/jobs/enrich/ai-company.ts */
  jobsCompanyEnrich: HAIKU,
  /** lib/jobs/evidence/draft.ts */
  jobsEvidenceDraft: OPUS,
  /** lib/jobs/evidence/match.ts */
  jobsEvidenceMatch: OPUS,
  /** lib/jobs/evidence/propose.ts */
  jobsEvidencePropose: OPUS,
  /** lib/jobs/inbox/tier-b.ts */
  jobsInboxTierB: HAIKU_DATED,
  /** lib/jobs/interview/prep.ts */
  jobsInterviewPrep: OPUS,
  /** lib/jobs/learning/suggest.ts */
  jobsLearningSuggest: OPUS,
  /** lib/jobs/role-thread/model.ts */
  roleCommentReply: SONNET,
  /** lib/jobs/suggest/model.ts */
  jobsSuggest: SONNET,
  /** lib/learn/areas/place.ts */
  learnAreaPlace: OPUS,
  /** lib/learn/catalogue/judge.ts */
  learnCatalogueJudge: HAIKU,
  /** lib/learn/feed/name-material.ts */
  learnNameMaterial: SONNET,
  /** lib/learn/feed/write-card.ts */
  learnWriteCard: SONNET,
  /** lib/learn/graph/applied.ts */
  learnApplied: HAIKU,
  /** lib/learn/graph/curriculum.ts */
  learnCurriculum: SONNET,
  /** lib/learn/graph/floor.ts */
  learnFloor: SONNET,
  /** lib/learn/graph/from-brief.ts */
  learnGraphFromBrief: SONNET,
  /** lib/learn/graph/from-course.ts */
  learnGraphFromCourse: SONNET,
  /** lib/learn/graph/from-note.ts */
  learnGraphFromNote: HAIKU,
  /** lib/learn/graph/from-prior.ts */
  learnGraphFromPrior: SONNET,
  /** lib/learn/graph/generate.ts */
  learnGraphGenerate: SONNET,
  /** lib/learn/graph/misconception.ts */
  learnMisconception: HAIKU,
  /** lib/learn/graph/opening-claims.ts */
  learnOpeningClaims: SONNET,
  /** lib/learn/graph/opening-probe.ts */
  learnOpeningProbe: HAIKU,
  /** lib/learn/graph/probe.ts */
  learnProbe: HAIKU,
  /** lib/learn/import/areas.ts */
  learnImportAreas: SONNET,
  /** lib/learn/import/parse.ts */
  learnImportParse: HAIKU_DATED,
  /** lib/learn/import/plan-topic.ts */
  learnImportPlanTopic: OPUS,
  /** lib/learn/import/resolve.ts */
  learnImportResolve: OPUS,
  /** lib/learn/import/suggest.ts */
  learnImportSuggest: OPUS,
  /** lib/learn/lessons/write-lesson.ts */
  learnWriteLesson: SONNET,
  /** lib/learn/locate/locate.ts */
  learnLocate: HAIKU_DATED,
  /** lib/learn/quiz/generate.ts */
  learnQuiz: HAIKU,
  /** lib/learn/survey/goal-idea.ts */
  learnSurveyGoalIdea: HAIKU,
  /** lib/learn/survey/idea.ts */
  learnSurveyIdea: HAIKU,
  /** lib/learn/vault/classify.ts */
  learnVaultClassify: HAIKU,
  /** lib/learn/youtube/channel-search.ts */
  learnFindChannels: SONNET,
  /** lib/learn/youtube/judge-video.ts */
  learnJudgeVideo: HAIKU,
  /** lib/learn/youtube/video-summary.ts */
  learnVideoSummary: HAIKU,
  /** lib/news/issues/digest.ts */
  newsDigest: HAIKU,
  /** lib/news/issues/importance.ts */
  newsImportance: HAIKU,
  /** lib/news/recommend/make.ts */
  newsRecommend: OPUS,
  /** lib/recurring/extract.ts */
  recurringExtract: HAIKU_DATED,
  /** lib/sell/web-estimate.ts */
  sellWebEstimate: HAIKU,
  /** lib/talk/reply.ts */
  talk: SONNET,
  /** lib/timeline/observations-model.ts */
  timelineObservations: SONNET,
  /** lib/timeline/year-review-model.ts */
  timelineYearReview: SONNET,
  /** lib/todo/appointments/extract.ts */
  appointmentsExtract: HAIKU_DATED,
  /** lib/vault/map/classify.ts */
  vaultMapClassify: HAIKU,
  /** lib/vault/map/extract.ts */
  vaultMapExtract: HAIKU,
  /** lib/vault/map/merge-pass.ts */
  vaultMapMerge: HAIKU,
  /** lib/vault/maya/reply.ts */
  mayaReply: SONNET,
  /** lib/vault/maya/thought-model.ts */
  mayaThought: OPUS,
  /** lib/vault/notes/connections-model.ts */
  vaultConnections: HAIKU,
  /** lib/vault/transcript-model.ts */
  vaultTranscript: HAIKU,
  /** lib/week-review/model.ts */
  weekReview: SONNET,
} as const;

export type ModelKey = keyof typeof MODELS;
