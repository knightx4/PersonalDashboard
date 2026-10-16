/**
 * Every Claude model id the app calls, in one place (plan #1464).
 *
 * Changing which model a part of the app uses is a one-line change here: each
 * call site reads its entry in `MODELS` by name, and no other file spells a
 * model id (lib/core/models.test.ts checks that). The three tiers below are the
 * only strings the entries name.
 *
 * The retired ids below are no longer called. They stay so that the rows the
 * spend ledger recorded under them can still be priced (lib/core/spend/pricing.ts).
 */

export const OPUS = 'claude-opus-5-5';
export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';

/** Retired: the models the ledger recorded before the move to the 5.5 models. */
export const OPUS_5 = 'claude-opus-5';
export const SONNET_5 = 'claude-sonnet-5';
export const HAIKU_4_5 = 'claude-haiku-4-5';
export const HAIKU_4_5_DATED = 'claude-haiku-4-5-20251001';

/** The model each call site uses, keyed by what the call does. Grouped by the file that makes it. */
export const MODELS = {
  /** lib/dash/ask.ts, Ask Dash; the same model as `talk` today */
  dashAsk: SONNET,
  /** inngest/dev/suggest.ts */
  devDigestSuggest: HAIKU,
  /** lib/books/receipt-photo.ts */
  booksReceiptPhoto: HAIKU,
  /** lib/orders/sentence-model.ts, an order from a sentence typed into capture */
  shoppingOrderSentence: HAIKU,
  /** lib/comments/ask.ts, Dash's reply on a dev row (lib/dash/models.ts devThread) */
  devCommentReply: SONNET,
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
  emailOrderExtract: HAIKU,
  /** lib/capture/sort-model.ts, where a typed capture belongs */
  captureSort: HAIKU,
  /** lib/goals/capture-model.ts */
  goalCapture: HAIKU,
  /** lib/goals/ask.ts, Dash's reply on a goal (lib/dash/models.ts goalThread) */
  goalCommentReply: SONNET,
  /** lib/goals/extract-model.ts */
  goalExtract: HAIKU,
  /** lib/goals/hold-acts-model.ts */
  goalHoldActs: HAIKU,
  /** lib/jobs/enrich/ai-company.ts */
  jobsCompanyEnrich: HAIKU,
  /** lib/jobs/evidence/draft.ts */
  jobsEvidenceDraft: OPUS,
  /** lib/jobs/drafting/draft-cover-letter.ts */
  jobsCoverLetterDraft: OPUS,
  /** lib/jobs/drafting/draft-application.ts, every answer on an application in one call */
  jobsApplicationDraft: OPUS,
  /** lib/jobs/evidence/match.ts */
  jobsEvidenceMatch: OPUS,
  /** lib/jobs/evidence/propose.ts */
  jobsEvidencePropose: OPUS,
  /** lib/jobs/inbox/tier-b.ts */
  jobsInboxTierB: HAIKU,
  /** lib/jobs/interview/prep.ts */
  jobsInterviewPrep: OPUS,
  /** lib/jobs/role-thread/ask.ts, Dash's reply on a role (lib/dash/models.ts roleThread) */
  roleCommentReply: SONNET,
  /** lib/thread/ask.ts, Dash's reply under any other row, a file first (lib/dash/models.ts rowThread) */
  rowCommentReply: SONNET,
  /** lib/jobs/suggest/model.ts */
  jobsSuggest: SONNET,
  /** lib/jobs/discover/shortlist-run.ts; one call a week over about 1,400 startups */
  jobsDiscoverShortlist: SONNET,
  /** lib/learn/areas/place.ts; Sonnet since theme placement runs hourly */
  learnAreaPlace: SONNET,
  /** lib/learn/catalogue/judge.ts */
  learnCatalogueJudge: HAIKU,
  /** lib/learn/places/name.ts; a few words for each place on Idea Space, daily */
  learnPlaceNames: HAIKU,
  /** lib/learn/feed/name-material.ts; a reply of about 230 tokens */
  learnNameMaterial: HAIKU,
  /** lib/learn/feed/write-card.ts */
  learnWriteCard: SONNET,
  /** lib/learn/feed/clip-note.ts; two sentences about a lecture clip, hourly */
  learnClipNote: HAIKU,
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
  /** lib/you/personality/read-run.ts, Dash's read of a personality result; Sonnet as #1630 settled */
  youPersonalityRead: SONNET,
  /** lib/learn/graph/from-note.ts */
  learnGraphFromNote: HAIKU,
  /** lib/learn/graph/judge-concepts.ts, one call per note read into the graph */
  learnNoteConceptJudge: HAIKU,
  /** lib/learn/graph/from-prior.ts */
  learnGraphFromPrior: SONNET,
  /** lib/learn/graph/generate.ts */
  learnGraphGenerate: SONNET,
  /** lib/learn/levels/draft.ts; a topic's ten levels, drafted from a goal */
  learnTopicDraft: SONNET,
  /** lib/learn/levels/move-call.ts; one call per subject moved from the claims graph */
  learnTopicAssign: SONNET,
  /** lib/learn/graph/misconception.ts */
  learnMisconception: HAIKU,
  /** lib/learn/graph/opening-claims.ts */
  learnOpeningClaims: SONNET,
  /** lib/learn/graph/opening-probe.ts */
  learnOpeningProbe: HAIKU,
  /** lib/learn/graph/probe.ts */
  learnProbe: HAIKU,
  /** lib/learn/levels/grade-call.ts, an explanation graded against several levels at once */
  learnLevelGrade: HAIKU,
  /** lib/learn/levels/grade-call.ts, the second grader of the same answer; kept for agreement, writes no evidence */
  learnLevelGradeSecond: SONNET,
  /** lib/learn/levels/case-call.ts, a case written for a level 4 to 6 cell */
  learnLevelCase: HAIKU,
  /** lib/learn/lessons/match-piece-cells.ts, the cells each piece of a unit teaches */
  learnPieceCells: HAIKU,
  /** lib/learn/chat/subjects.ts */
  learnChatSubjects: HAIKU,
  /** lib/learn/import/areas.ts */
  learnImportAreas: SONNET,
  /** lib/learn/import/parse.ts */
  learnImportParse: HAIKU,
  /** lib/learn/import/plan-topic.ts */
  learnImportPlanTopic: OPUS,
  /** lib/learn/import/resolve.ts */
  learnImportResolve: OPUS,
  /** lib/learn/import/suggest.ts */
  learnImportSuggest: OPUS,
  /** lib/learn/lessons/write-lesson.ts */
  learnWriteLesson: SONNET,
  /** lib/learn/locate/locate.ts */
  learnLocate: HAIKU,
  /** lib/learn/tracks/reading-summary-model.ts, Summarize on a reading's page */
  learnReadingSummary: SONNET,
  /** lib/learn/tracks/reading-chat-model.ts, the chat with Dash on a reading's page */
  learnReadingChat: SONNET,
  /** lib/learn/quiz/generate.ts */
  learnQuiz: HAIKU,
  /** lib/learn/survey/goal-idea.ts */
  learnSurveyGoalIdea: HAIKU,
  /** lib/learn/essays/interview-model.ts, the next question of an essay's interview */
  learnEssayInterview: SONNET,
  /** lib/learn/essays/guide-model.ts, the guided essay: reading the brief, finding points, shapes, plan notes, questions on a point, and writing up the research */
  learnEssayGuide: SONNET,
  /** lib/learn/essays/rephrase-model.ts, Rephrase on a selected sentence of an essay */
  learnEssayRephrase: SONNET,
  /** lib/learn/essays/checks-model.ts, a named check on one paragraph of an essay */
  learnEssayCheck: SONNET,
  /** lib/learn/essays/finish-model.ts, the claims a finished essay argues */
  learnEssayClaims: SONNET,
  /**
   * lib/learn/essays/research-model.ts, an essay's first research pass and
   * the deeper pass's gathering: Haiku with the basic web search and fetch
   * tools, since the dynamic-filtering versions are for Opus and Sonnet only
   */
  learnEssayResearch: HAIKU,
  /** lib/learn/essays/research-model.ts, the deeper pass marking each claim against the pages read */
  learnEssayJudge: SONNET,
  /** lib/learn/briefs/research-model.ts, a research brief's question split into sub-questions */
  learnBriefFrame: SONNET,
  /** lib/learn/briefs/research-model.ts, a brief's searches and pages read, on the basic web tools as the essay's are */
  learnBriefSearch: HAIKU,
  /** lib/learn/briefs/research-model.ts, a brief's positions and short answer, cited from the pages read */
  learnBriefWrite: SONNET,
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
  /** lib/news/review/write.ts */
  newsDailyReview: SONNET,
  /** lib/news/recommend/make.ts */
  newsRecommend: OPUS,
  /** lib/recurring/extract.ts */
  recurringExtract: HAIKU,
  /** lib/dash/interview.ts, Dash's questions when it interviews you for a workspace's spec (lib/dash/models.ts interview) */
  specInterview: SONNET,
  /** lib/dash/interview-draft.ts, the vision and spec Dash drafts when an interview ends (lib/dash/models.ts interviewDraft) */
  specInterviewDraft: SONNET,
  /** lib/sell/web-estimate.ts */
  sellWebEstimate: HAIKU,
  /** lib/talk/reply.ts */
  talk: SONNET,
  /** lib/timeline/observations-model.ts */
  timelineObservations: SONNET,
  /** lib/timeline/year-review-model.ts */
  timelineYearReview: SONNET,
  /** lib/todo/appointments/extract.ts */
  appointmentsExtract: HAIKU,
  /** lib/vault/map/classify.ts */
  vaultMapClassify: HAIKU,
  /** lib/vault/map/extract.ts */
  vaultMapExtract: HAIKU,
  /** lib/vault/map/merge-pass.ts */
  vaultMapMerge: HAIKU,
  /** lib/vault/maya/thought-model.ts and reply.ts: Maya's voice, its thoughts and its replies (lib/dash/models.ts maya) */
  maya: OPUS,
  /** lib/vault/notes/connections-model.ts */
  vaultConnections: HAIKU,
  /** lib/you/transcript-model.ts */
  vaultTranscript: HAIKU,
  /** lib/you/work-history-model.ts */
  youWorkHistory: HAIKU,
  /** lib/week-review/model.ts */
  weekReview: SONNET,
} as const;

export type ModelKey = keyof typeof MODELS;
