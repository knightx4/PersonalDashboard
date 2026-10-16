import { askListFilter, askListLabel } from '@/lib/ask/list-filter';
import { BurnUpSurface } from './burn-up-surfaces';
import { CellAnswerPreview, PracticeRunPreview } from './cell-answer-surface';
import {
  GoalMetricsEmptySurface,
  GoalMetricsErrorSurface,
  GoalMetricsSurface,
  GoalMetricsTooltipSurface,
} from './goal-metrics-surfaces';
import { filterPipeline, parsePipeline } from '@/lib/jobs/pipeline-view';
import { RoleDetailPanels, type PanelProps } from '@/app/jobs/(app)/roles/[id]/panels';
import type { DiscoveredCompany } from '@/lib/jobs/discover/watchlist-view';
import { openingSource } from '@/lib/jobs/suggest/source';
import { CompanyRoles } from '@/app/jobs/(app)/companies/[slug]/company-roles';
import { YouTabEmpty } from '@/app/you/you-tabs';
import { PlacesView } from '@/app/you/places/places-view';
import { DetailsView } from '@/app/you/details/details-view';
import { EMPTY_DETAILS, type Details } from '@/lib/you/details';
import { PlaceView } from '@/app/you/places/place-view';
import { PlaceForm } from '@/app/you/places/place-form';
import type { Place } from '@/lib/you/places';
import { drawPlaceMap, drawPlacesMap } from '@/lib/you/places-map-outlines';
import type { RoleReminder } from '@/app/jobs/(app)/roles/[id]/types';
import { RoleTodos } from '@/app/jobs/(app)/roles/[id]/todos';
import type { Task } from '@/lib/todo/tasks/model';
import { ClosedSummary } from '@/app/jobs/(app)/roles/[id]/closed-summary';
import { defaultRoleTab } from '@/app/jobs/(app)/roles/[id]/tabs';
import { AnswerCard } from '@/app/jobs/(app)/roles/[id]/application';
import { closedSummary } from '@/lib/jobs/role-stage';
import { ExcitementPicker } from '@/app/jobs/(app)/roles/[id]/excitement-picker';
import { Property } from '@/components/shell/detail-layout';
import { DetailFacts } from '@/components/patterns/list-detail';
import { ChannelPicker } from '@/app/jobs/(app)/roles/[id]/channel-picker';
import type { ReferrerOption } from '@/lib/jobs/contacts/referrers';
import { StatusPicker } from '@/components/jobs/ui/status-picker';
import { PipelineDenseList } from '@/components/jobs/pipeline/dense-list';
import { SurfaceReview } from '@/app/dev/surfaces/review';
import { SearchBarSurface } from './search-bar-surface';
import {
  IdeaSpaceAroundSurface,
  IdeaSpacePlaceSurface,
  IdeaSpaceRecordingChooseSurface,
  IdeaSpaceRecordingSurface,
  IdeaSpaceReplaySurface,
  IdeaSpaceCardSurface,
  IdeaSpaceDenseSurface,
  IdeaSpaceDomainsSurface,
  IdeaSpaceLightsSurface,
  IdeaSpaceEvidenceSurface,
  IdeaSpaceSurface,
  IdeaSpaceTopicsSurface,
} from './idea-space-surfaces';
import { DashMarkRunners } from './dash-mark-surface';
import { UiKit } from './ui-kit-surface';
import { RefPreviewSurface } from './ref-preview-surface';
import { AimedCaptureSurface, CaptureBoxSurface } from './capture-surfaces';
import { ShoppingAimedCameraSurface, ShoppingAimedSurface, ShoppingListAddsSurface } from './shopping-capture-surfaces';
import { AimedJobsLearnSurface, AimedPlaceSurface } from './capture-surfaces';
import { DayBarsEmptySurface, DayBarsReadoutSurface, DayBarsSurface, SpendByModuleSurface, SpendOverviewSurface } from './day-bars-surfaces';
import { TaskFilesSurface } from './task-files-surfaces';
import { UiStandard } from '@/app/dev/ui/standard';
import { TasteList } from '@/app/dev/ui/taste-list';
import { TASTE } from '@/app/dev/ui/taste';
import { CorrectionsChart } from '@/app/dev/ui/corrections';
import type { CorrectionWeek } from '@/lib/plan/correction-share';
import { SentBackChart } from '@/app/dev/ui/sent-back';
import type { SentBackWeek } from '@/lib/plan/sent-back';
import { ANATOMIES } from '@/app/dev/ui/anatomy';
import { PATTERNS } from '@/app/dev/ui/patterns';
import { TravelDemo } from '@/app/dev/ui/travel-demo';
import { SettleDemo } from '@/app/dev/ui/settle-demo';
import { ClearDemo } from '@/app/dev/ui/clear-demo';
import { DayCloseDemo } from '@/app/dev/ui/day-close-demo';
import { DayClosed } from '@/components/todo/day-closed';
import { GotThroughDemo } from '@/app/dev/ui/got-through-demo';
import { GotThrough } from '@/app/news/quick/got-through';
import { HomeArrivalDemo } from '@/app/dev/ui/home-arrival-demo';
import { ItemDetailsPanel } from '@/app/shopping/inventory/[id]/item-details-panel';
import { ShoppingItemCatalogueSurface } from './shopping-catalogue-surfaces';
import { EstimatesTable } from '@/app/account/spend/estimates-table';
import { compareEstimate } from '@/lib/core/spend/comparison';
import {
  ESTIMATE_WINDOW_DAYS,
  MEASURED_MIN_RUNS,
  type MeasuredRange,
} from '@/lib/core/spend/estimate';
import type { OperationName } from '@/lib/core/spend/guesses';
import { CompanyPanels } from '@/app/jobs/(app)/companies/[slug]/panels';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { ReviewQueue } from '@/app/jobs/(app)/review/list';
import { JobsSettingsView } from '@/app/jobs/(app)/settings/settings-view';
import { GoalsSettingsView } from '@/app/goals/settings/settings-view';
import { LearnSettingsView } from '@/app/learn/settings/settings-view';
import { MaterialView, type MaterialProps } from '@/app/jobs/(app)/material/material-view';
import { ContactsView, type ContactListRow, type ContactRow } from '@/app/jobs/(app)/contacts/view';
import { ContactDetail } from '@/app/jobs/(app)/contacts/[id]/contact-detail';
import { RecommendedRoles } from '@/app/jobs/(app)/find/sections';
import { FindView } from '@/app/jobs/(app)/find/view';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import type { OriginStats } from '@/lib/jobs/suggest/stats';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ReviewRow, SearchableRole } from '@/lib/jobs/review/load';
import { PipelinePage } from '@/components/jobs/pipeline/pipeline-page';
import { RoundsTable, type RoundView } from '@/app/jobs/(app)/interviews/rounds-table';
import { TodayLists } from '@/app/jobs/(app)/_home/this-week-lists';
import { TodayPage } from '@/app/jobs/(app)/_home/today-page';
import { summariseSearch } from '@/lib/jobs/home/summary';
import type { SinceView } from '@/lib/jobs/home/since-load';
import type { TodayBoard } from '@/lib/jobs/today/load';
import type { ModuleId } from '@/lib/modules';
import type { Interaction } from '@/lib/preview/interaction';
import type { Deck } from '@/lib/preview/deck';
import { AgendaRowsSurface, LaterMenuRows } from './later-menu-surface';
import { CloseButtonRows } from './close-buttons-surface';
import {
  GoalArchiveConfirmSurface,
  GoalPutAwayMenuSurface,
  GoalsAllPutAwayMenuSurface,
  GoalsAllPutAwayToastSurface,
  GoalsAllSelectConfirmSurface,
  GoalsAllSelectSurface,
  GoalsAllSelectToastSurface,
} from './goal-put-away-surfaces';
import { CalendarMonthGrid } from '@/components/todo/calendar-month';
import { FeedEventCard } from '@/components/todo/feed-event-card';
import {
  monthDays,
  monthOf,
  type CalendarDay,
  type CalendarEntry,
} from '@/lib/todo/calendar/month';
import { NewVaultNote } from '@/components/vault/new-note';
import { QuickNoteRow } from '@/components/vault/quick-note';
import { TriagePreview } from './triage-surfaces';
import { NoteProperties } from '@/components/vault/note-properties';
import { NoteBody } from '@/components/vault/note-body';
import { NoteEdit } from '@/app/vault/n/[...path]/note-edit';
import { NoteEditingPreview, NoteRenamePreview } from './note-edit-surfaces';
import { buildAttachmentIndex, type AttachmentEntry } from '@/lib/vault/markdown/attachments';
import { buildLinkIndex, toStandardMarkdown } from '@/lib/vault/markdown/obsidian';
import { noteHref } from '@/lib/vault/paths';
import { AimButton } from '@/components/shell/aim-button';
import { PageHeader } from '@/components/shell/page-header';
import { SectionHeading } from '@/components/ui/section-heading';
import {
  PersonalityAddTypeSurface,
  PersonalityScoresSurface,
  PersonalityTestSurface,
  YouPersonalitySurface,
  YouPersonalityEmptySurface,
  YouPersonalityReadingSurface,
} from './personality-surfaces';
import { EducationSection } from '@/app/you/work/education-section';
import { EducationCheckPreview, EducationUploadPreview } from './education-surfaces';
import { FlowScopePreview, LearnGoalsPreview } from './learn-goal-surfaces';
import { FlowExplainPreview } from './learn-flow-explain-surfaces';
import { FlowSummaryPreview } from './learn-flow-summary-surfaces';
import {
  LearnTopicDraftCommentPreview,
  LearnTopicDraftMatchPreview,
  LearnTopicDraftPreview,
  LearnTopicsErrorPreview,
  LearnTopicsLoadingPreview,
  LearnTopicsPreview,
  LearnTopicPreview,
  LearnTopicEmptyPreview,
  LearnTopicQuotesPreview,
  LearnTopicEditPreview,
  LearnTopicLoadingPreview,
  LearnTopicDraftChecksPreview,
  LearnTopicsSourcesPreview,
} from './learn-topic-surfaces';
import {
  LearnKnowLensesEmptyPreview,
  LearnKnowLensesPreview,
  LearnLensEditPreview,
  LearnLensEmptyPreview,
  LearnLensErrorPreview,
  LearnLensFringePreview,
  LearnLensLoadingPreview,
  LearnLensPreview,
  LearnLensUntouchedPreview,
} from './learn-lens-surfaces';
import {
  LearnTopicsReviewEmptyPreview,
  LearnTopicsReviewPreview,
  LearnTopicsReviewRunningPreview,
} from './learn-move-surfaces';
import {
  LearnCourseCheckPreview,
  LearnCoursesEmptyPreview,
  LearnCoursesListPreview,
} from './learn-course-surfaces';
import {
  LearnConceptSurface,
  LearnConceptEvidenceSurface,
  LearnListsSurface,
  LearnOpeningSurface,
  LearnPieceSurface,
  LearnPieceCellCheckSurface,
  LearnProbeSurface,
  LearnQuizSurface,
  LearnQuizTakeSurface,
  LearnExternalSurface,
  LearnExternalItemSurface,
  LearnExternalNewSurface,
  LearnExternalScoreSurface,
  LearnReadingSurface,
  LearnReadingTextSurface,
  LearnReadingSummarySurface,
  LearnReadingChatSurface,
  LearnReadingUnreadableSurface,
  LearnReadingCheckSurface,
  LearnReadingCheckOwnSurface,
  LearnVideoSurface,
  LearnVideosSurface,
  LearnYoutubeChannelSurface,
  LearnYoutubePlaylistSurface,
  LearnYoutubeVideoSurface,
} from './learn-page-surfaces';
import {
  LearnEssayBriefSurface,
  LearnEssayChangedSurface,
  LearnEssayMarksSurface,
  LearnEssayNotesSurface,
  LearnEssayRephraseSurface,
  LearnEssayStudyEmptySurface,
  LearnEssayResearchSurface,
  LearnEssayFinishSurface,
  LearnEssayPublishSurface,
  LearnEssayInterviewSurface,
  LearnEssayNotesMapSurface,
  LearnEssayDraftFromNotesSurface,
  LearnEssaySurface,
  LearnPlanFinishedSurface,
  LearnSubjectConversationsSurface,
  LearnEssaysEmptySurface,
  LearnEssaysSurface,
} from './essay-surfaces';
import {
  LearnBriefFailedSurface,
  LearnBriefQuoteSourceSurface,
  LearnBriefResearchingSurface,
  LearnBriefShortAnswerEditorSurface,
  LearnBriefSurface,
  LearnBriefNewSourcesSurface,
  LearnNowBriefsSurface,
} from './brief-surfaces';
import { educationGroups, educationCounts, educationExplains } from './education-fixtures';
import { workHistoryJobs, workHistoryResume } from './work-history-fixtures';
import { JobsSection } from '@/app/you/work/jobs-section';
import { ReadingCard } from '@/components/learn/reading-card';
import { LearnNowFeed } from '@/app/learn/now/feed';
import {
  TodaysPieceCheckSurface,
  TodaysPieceDoneSurface,
  TodaysPieceErrorSurface,
  TodaysPieceLoadingSurface,
  TodaysPieceNoneSurface,
  TodaysPieceSurface,
} from './todays-piece-surfaces';
import { BriefQuickPreview, LearnNowResearchNewPreview, LearnNowResearchPreview } from './brief-quick-surfaces';
import { NowHeader } from '@/app/learn/now/header';
import type { FeedCard } from '@/lib/learn/feed/card';
import { ConceptList } from '@/components/learn/concept-list';
import type { ReadingRow } from '@/lib/learn/tracks/load';
import type { Concept } from '@/lib/learn/graph/model';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { StatusLine } from '@/components/shell/status-line';
import type { GoingRunLine } from '@/components/runs/use-going-run-line';
import { RouteErrorSurface, RouteNotFoundSurface } from './route-state-surfaces';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';
import {
  groupRows,
  isHidden,
  listDisplayMenu,
  parseListDisplay,
  sortRows,
  type ListDisplaySpec,
} from '@/lib/list-display';
import { formatMoney } from '@/lib/money';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import type { DevComment } from '@/lib/comments/load';
import type { DashChange } from '@/lib/talk/changes';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { Button, buttonVariants } from '@/components/ui/button';
import { CostHint } from '@/components/ui/cost-hint';
import { Tooltip } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/icon-button';
import { Chip } from '@/components/ui/chip';
import { StateLabel } from '@/components/dev/state-label';
import { healthOf as planHealthWords } from '@/lib/plan/health-words';
import { IDEA_HEALTH_WORD, WAITING_TITLE, WAITING_WORD } from '@/lib/dev/words';
import { IDEA_HEALTH_GLYPHS, PLAN_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import { Clock, Pin } from 'lucide-react';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { HAIKU, OPUS, SONNET } from '@/lib/core/models';
import { IssueView, type IssueViewProps } from '@/app/news/i/[id]/issue-view';
import { QuickReadView, type QuickReadViewProps } from '@/app/news/quick/quick-view';
import { SavedView, type SavedViewProps } from '@/app/news/saved/saved-view';
import { ReviewView, type ReviewViewProps } from '@/app/news/review/review-view';
import { NeedsConfirming } from '@/app/news/all/needs-confirming';
import { StoryGrid, type GridStory } from '@/components/news/story-grid';
import { StoryText } from '@/components/news/story-text';
import {
  PlanCriticStopSurface,
  PlanScreenChangeSurface,
  PlanScreenMockupSurface,
  PlanSendBackSurface,
  PlanOpenedSurface,
  PlanFeatureSurface,
  PlanFeatureEditSurface,
  PlanFeatureStepsSurface,
  PlanFeatureStepsYoursSurface,
  PlanFeatureActivitySurface,
  PlanTreeSurface,
  PlanAssigneeTipSurface,
  PlanTableSurface,
  ProjectPlanSurface,
} from './plan-surfaces';
import {
  GoalOpenedSurface,
  GoalStepSurface,
  GoalSubStepSurface,
  GoalTreeSurface,
  GoalAssigneeTipSurface,
  GoalEmptySurface,
} from './goal-surfaces';
import { StepArrivalDemo, StepCloseDemo } from './goal-moment-demos';
import { GoalPageArrivalDemo, GoalPageCloseDemo } from './goal-page-moments';
import { BoardMomentDemo } from './jobs-moment-demos';
import { DashRunButtonDemo, DashSeenDemo } from './dash-moment-demos';
import { DashWorkingReadingDemo } from './dash-working-rows';
import { NoteListRow } from '@/components/vault/note-list-row';
import { IssueListRow } from '@/app/news/all/list-view';
import { OPEN_STATUSES } from '@/lib/jobs/board-moment';
import {
  AskBuildSurface,
  AskDeleteSurface,
  AskPaidSurface,
  AskChangesSurface,
  AT_WORK_QUESTION,
  AskDashSurface,
  AskMadeChangesSurface,
  DashPageSurface,
  AskAnswerActionsSurface,
  AskBoxSurface,
  FAILING_QUESTION,
  TRIP_GOAL,
  WRITING_QUESTION,
} from './ask-surfaces';
import { TalkThreadFilesSurface, TalkThreadSurface } from './talk-thread-surface';
import { RecurringEmptySurface, RecurringSurface } from './recurring-surfaces';
import { TimelineSurface, YearReviewSurface } from './timeline-surfaces';
import { GoToSurface, LearnReviewListSurface } from './notes-batch-surfaces';
import { WatchingSurface } from './watching-surfaces';
import { DashTodaySurface, NowDashTodaySurface } from './dash-today-surfaces';
import { LogDoneSurface } from './log-done-surfaces';
import { GoalSuggestionsSurface } from './goal-suggestions-surfaces';
import {
  GoalMetricPropsEmptySurface,
  GoalMetricPropsErrorSurface,
  GoalMetricPropsFormSurface,
  GoalMetricPropsMenuSurface,
  GoalMetricPropsPendingSurface,
  GoalMetricPropsSurface,
} from './goal-metric-props-surfaces';
import { HomePageSurface } from './home-page-surfaces';
import {
  SubjectArticlesEmptySurface,
  SubjectArticlesErrorSurface,
  SubjectArticlesLoadingSurface,
  SubjectArticlesSurface,
} from './subject-articles-surfaces';
import { ClipStreamSurface, ClipsEmptySurface, SubjectClipsEmptySurface, SubjectClipsSurface } from './clip-surfaces';
import {
  InspirationByVideoSurface,
  InspirationListSurface,
  InspirationUnreadSurface,
} from './inspiration-surfaces';
import {
  PostsCommentSurface,
  PostsDraftingSurface,
  PostsWantsEditSurface,
  PostsWantsSavingSurface,
  PostsWantsSurface,
  PostsMatchedSurface,
  PostsNoDraftSurface,
  PostsSendSurface,
  PostsSurface,
  PostsThreadSurface,
  PostsWriteSurface,
  PostsXSurface,
} from './posts-surfaces';
import {
  GoalBareSurface,
  GoalLinkingSurface,
  GoalTopSurface,
  GoalStepsTabSurface,
  GoalActivitySurface,
  FileSurface,
  GoalsAllSurface,
  GoalsAreaSurface,
  GoalsHomeSurface,
  GoalsInboxSurface,
  InformationListSurface,
  InformationOneSurface,
} from './goal-page-surfaces';
import { InboxPageSurface } from './inbox-page-surface';
import { HomeInboxSurface } from './home-inbox-surfaces';
import {
  JobsInboxSurface,
  LearnInboxSurface,
  NewsInboxSurface,
  ShoppingInboxSurface,
  TodoInboxSurface,
  VaultInboxSurface,
} from './workspace-inbox-surfaces';
import {
  AuthCodeErrorSurface,
  ConsentSurface,
  FrontDoorSurface,
  LoginSurface,
  OnboardingGmailSurface,
  OnboardingWelcomeSurface,
  OpenMissingSurface,
  PrivacySurface,
  ResetPasswordSurface,
  ShareFormSurface,
  SignupSurface,
  TermsSurface,
} from './public-surfaces';
import { WeekReviewNoneSurface, WeekReviewSurface } from './week-surfaces';
import { JobsInsightsSurface } from './jobs-insights-surface';
import {
  JobsActivitySurface,
  JobsAnalyticsSurface,
  JobsAnswersSurface,
  JobsCasePageSurface,
  JobsOnboardingSurface,
} from './jobs-page-surfaces';
import { GoalRunSurface, MailMessageSurface } from './mail-run-surfaces';
import { RunLinesSurface } from './run-lines-surfaces';
import { PlanRunSurface } from './plan-run-surfaces';
import {
  AccountSurface,
  DevBugsSurface,
  DevChangelogSurface,
  DevChangelogScreensSurface,
  DevIdeasSurface,
  DevIdeasEmptySurface,
  DevRaisedSurface,
  DevInboxSurface,
  DevSettingsSurface,
  DevRunnerCrewSurface,
  DevSpecSurface,
  DevSpecsSurface,
  DevSpecsInterviewEmptySurface,
  DevSpecsInterviewHalfSurface,
  DevSpecsInterviewDraftedSurface,
  DevUiReviewSurface,
  DevUsageEmptySurface,
  DevUsageSurface,
} from './dev-page-surfaces';
import { DevModuleIdeasSurface, DevModuleSurface, DevModulesSurface } from './module-surfaces';
import {
  NewsAllSurface,
  NewsSettingsSurface,
  NewsStorySurface,
  TodoAllSurface,
  TodoSettingsSurface,
  TodoWaitingSurface,
} from './news-todo-page-surfaces';
import {
  ShoppingDashboardEmptySurface,
  ShoppingDashboardSurface,
  ShoppingOrderSurface,
  ShoppingReturnsSurface,
  ShoppingSavedItemSurface,
  ShoppingSavedSurface,
  ShoppingSettingsSurface,
  ShoppingShareFamiliesSurface,
  ShoppingShareSurface,
  ShoppingSharesSurface,
} from './shopping-page-surfaces';
import {
  VaultMapSurface,
  VaultMayaSurface,
  VaultMayaThreadSurface,
  VaultSettingsSurface,
  VaultThemeSurface,
} from './vault-page-surfaces';
import { PageColumn } from '@/components/shell/page-width';

/**
 * The surfaces worth looking at, rendered from the real components.
 *
 * The point of this file is the imports at the top of it. Every previous
 * attempt at seeing this app -- five sweeps' worth -- hand-wrote markup that
 * *resembled* a surface, screenshotted that, and concluded something about the
 * app. That is a drawing of the thing, and a drawing agrees with whatever the
 * person drawing it already believed. These are the components themselves,
 * under the real tokens, at real widths.
 *
 * The fixtures are typed as the components' own props, which is what stops
 * this rotting: a prop that changes shape breaks `tsc` here, so a surface
 * cannot quietly start previewing something the app no longer renders.
 *
 * What it does not have is the shell, and the data does not come through a
 * loader or a database -- Docker is unavailable in this environment, so
 * PostgREST and GoTrue cannot run, and a real page cannot be served. So this
 * is honest about its scope: it is the content surfaces, which is where the
 * clunk lives and where every judgement call in the design laws applies. The
 * shell is one component and has already been swept.
 */
export type Surface = {
  id: string;
  label: string;
  /** Which workspace it belongs to, so the gallery and the review agree. */
  module: ModuleId;
  /**
   * How wide the thing is meant to be read at, in the real app. `page` is for
   * a whole page arrangement, which draws its own box the way a page does
   * rather than being centred in a column this route picked for it. `screen`
   * is for a page outside the shell that draws the whole screen itself (the
   * front door, the sign-in card, a shared form): no box and no workspace,
   * as the app serves it.
   */
  width: 'narrow' | 'wide' | 'page' | 'screen';
  render: () => React.ReactNode;
  /**
   * The press, swipe or completion `npm run record` plays on this surface and
   * keeps as a strip of frames (lib/preview/interaction.ts). Left out, the
   * surface is not recorded.
   */
  interaction?: Interaction;
  /**
   * Marks a screen you move through one item at a time, and where its Next
   * and its item are (lib/preview/deck.ts). The phone checks then hold it to
   * Next showing the next item with the network held, and to every control
   * and link showing a press within 100 milliseconds.
   */
  deck?: Deck;
};

/**
 * A role mid-process: a rejection at the top of the timeline, two inferred
 * events needing confirmation, one interview scheduled, an unanswered
 * question. Chosen to be an ordinary Tuesday rather than a showcase -- an
 * empty surface hides every density problem, and a maximal one hides which
 * problems are real.
 */
/**
 * The role's one to-do list (plan #1594): a task from Todo with a long title
 * and a reminder from the job module linked to its email, drawn together.
 */
const roleTasks: Task[] = [
  {
    id: 'task-1',
    title: 'Send Dana the paper on columnar storage she asked about in the screen',
    body: null,
    status: 'open',
    dueOn: '2026-09-16',
    dueAt: null,
    pinned: false,
    snoozedUntil: null,
    completedAt: null,
    createdAt: '2026-09-15T16:00:00.000Z',
    position: null,
    parentId: null,
  },
];

const roleReminderFixtures: RoleReminder[] = [
  {
    id: 't1',
    body: 'Record a video interview',
    dueAt: '2026-09-12T00:00:00.000Z',
    message: {
      id: 'm1',
      subject: 'Next steps with the Halloran-Achterberg group',
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/1',
    },
  },
];

const rolePanels: PanelProps = {
  roleId: 'role-1',
  applicationId: 'app-1',
  status: 'in_process',
  jdText:
    'We are looking for a quantitative developer to work alongside our systematic trading teams. You will build and maintain the research tooling that turns an idea into a backtest and a backtest into a live strategy.',
  jdLookupNote: null,
  jdUrl: 'https://example.com/jobs/quant-dev',
  atsJobId: 'REQ-4471',
  compMinCents: 18000000,
  compMaxCents: 24000000,
  compSource: 'posting',
  requirements: [
    { text: 'Strong Python', kind: 'must_have' },
    { text: 'Experience with market data at scale', kind: 'must_have' },
    { text: 'C++ a plus', kind: 'nice_to_have' },
  ],
  requirementMatches: null,
  requirementMatchesAt: null,
  requirementMatchesStale: false,
  bankSize: 6,
  coverLetter: '',
  coverLetterDraft: null,
  readyToApply: false,
  allQuestionsAdded: false,
  hasCoverLetter: null,
  timezone: 'Europe/London',
  focusInterviewId: null,
  events: [
    {
      id: 'e1',
      kind: 'rejection',
      occurredAt: '2026-09-08T09:02:00.000Z',
      source: 'email',
      summary: 'From the Halloran-Achterberg group',
      needsReview: false,
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/1',
    },
    {
      id: 'e4',
      kind: 'screen_scheduled',
      occurredAt: '2026-09-04T16:10:00.000Z',
      source: 'email',
      summary: 'Phone screen with Dana Okafor, 15 September',
      needsReview: false,
      gmailHref: null,
    },
    {
      id: 'e2',
      kind: 'confirmation',
      occurredAt: '2026-09-01T08:30:00.000Z',
      source: 'email',
      summary: 'Your application to the Halloran-Achterberg group',
      needsReview: false,
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/2',
    },
    {
      id: 'e3',
      kind: 'submitted',
      occurredAt: '2026-07-31T12:00:00.000Z',
      source: 'system',
      summary: 'Inferred from a confirmation email — confirm the details',
      needsReview: true,
      gmailHref: null,
    },
  ],
  interviews: [
    {
      id: 'i1',
      kind: 'phone_screen',
      scheduledAt: '2026-09-15T14:00:00.000Z',
      timeKnown: true,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      calendarHref: 'https://calendar.google.com/calendar/event?eid=YWJjMTIzIG1lQGV4YW1wbGUuY29t',
      debriefDue: false,
      format: 'video',
      status: 'scheduled',
      prepNotes: 'Ask how the research tooling team splits work with the strategy desks.',
      notes:
        'Forty minutes, mostly on the market data pipeline. Dana pressed on how I would backfill a day of bad ticks.\n\nFollow up with the paper on columnar storage she mentioned.',
      groupId: 'g1',
      questionsAsked: [],
      prepNote: null,
      prepNoteAt: null,
      prepNoteStale: false,
      participants: [
        { contactId: 'c1', name: 'Dana Ruiz', title: 'Engineering Manager', role: 'interviewer' },
      ],
    },
  ],
  companyContacts: [{ id: 'c1', name: 'Dana Ruiz', title: 'Engineering Manager' }],
  answers: [
    {
      id: 'a1',
      answer: '',
      status: 'unanswered',
      questionId: 'q1',
      questionText: 'Why this team?',
      questionKind: 'motivation',
      canonicalAnswer: null,
      timesSeen: 3,
      evidenceItemIds: [],
      unsupportedClaims: [],
      wordLimit: null,
    },
  ],
  answerDrafts: {},
  dashAsks: [],
  thread: [],
  interviewGroups: [
    { id: 'g1', label: 'First round', roundNumber: 1, notes: '', messageIds: [] },
    {
      id: 'g2',
      label: 'Technical',
      roundNumber: 2,
      notes:
        'Two interviewers, one system design and one code review. Ask about on-call before the end.',
      messageIds: [],
    },
  ],
  companyName: 'The Halloran-Achterberg group',
  matchCandidates: [],
  otherAttempts: [],
  messages: [
    {
      id: 'm1',
      subject: 'From the Halloran-Achterberg group',
      fromAddress: 'careers@halloran.example',
      receivedAt: '2026-09-08T09:02:00.000Z',
      classification: 'rejection',
      linkMethod: 'ats_id',
      linkConfidence: 0.98,
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/1',
    },
  ],
};

/**
 * An ordinary week's board: eleven pursuits across every live column, two
 * closed ones behind the fold, one gone quiet long enough to say so, and one
 * still waiting on its first confirmation.
 *
 * The names are the point. "Ramp" tells you nothing about wrapping and every
 * hand-drawn fixture in this app's history has been full of them, so the set
 * is deliberately mixed: a two-word company, a very long one, a role title
 * that will not fit a card, and one attempt that is somebody's second go.
 */
const pipelineRow = (
  row: Partial<PipelineRow> &
    Pick<PipelineRow, 'applicationId' | 'companyName' | 'roleTitle' | 'status'>,
): PipelineRow => ({
  roleId: `role-${row.applicationId}`,
  companyId: `co-${row.applicationId}`,
  companySlug: 'a-company',
  companyLogoUrl: null,
  companyDomains: [],
  companyWebsite: null,
  location: 'London',
  workMode: 'hybrid',
  source: 'portal',
  attempt: 1,
  excitement: 3,
  needsReview: false,
  readyToApply: false,
  allQuestionsAdded: false,
  hasCoverLetter: null,
  createdBy: 'user',
  submittedAt: '2026-08-14T09:00:00.000Z',
  confirmationReceivedAt: '2026-08-14T09:04:00.000Z',
  firstHumanResponseAt: null,
  closedAt: null,
  outcome: null,
  rejectionStage: null,
  nextAction: null,
  nextActionDue: null,
  lastActivityAt: '2026-09-05T10:00:00.000Z',
  daysSinceActivity: 4,
  lastTurnEvent: null,
  compMinCents: null,
  compMaxCents: null,
  coverage: { covered: 0, total: 0, gaps: 0, rate: null },
  ...row,
});

const pipelineRows: PipelineRow[] = [
  pipelineRow({
    applicationId: 'p1',
    companyName: 'Larkspur Vane',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    status: 'in_process',
    excitement: 5,
    readyToApply: true,
    allQuestionsAdded: false,
    hasCoverLetter: true,
    compMinCents: 18000000,
    compMaxCents: 24000000,
    daysSinceActivity: 1,
    lastActivityAt: '2026-09-08T16:00:00.000Z',
    coverage: { covered: 4, total: 6, gaps: 1, rate: 0.67 },
    nextInterview: { at: '2026-09-11T14:00:00.000Z', timeKnown: true },
  }),
  pipelineRow({
    applicationId: 'p2',
    companyName: 'The Halloran-Achterberg group',
    roleTitle: 'Software Developer',
    status: 'in_process',
    excitement: 4,
    readyToApply: true,
    allQuestionsAdded: true,
    hasCoverLetter: false,
    daysSinceActivity: 3,
    lastActivityAt: '2026-09-06T11:00:00.000Z',
    coverage: { covered: 5, total: 5, gaps: 0, rate: 1 },
    // Already interviewing, so chance is left off and only fit shows.
    scoreNote: { fit: { value: 73, unsure: false, reason: '5 of 5 must-haves met by your evidence' }, chance: null },
  }),
  pipelineRow({
    applicationId: 'p3',
    companyName: 'Tallow',
    roleTitle: 'Backend Engineer, Payments',
    status: 'acknowledged',
    source: 'referral',
    scoreNote: {
      fit: { value: 56, unsure: true, reason: 'Read from the title and level only, no description on file' },
      chance: { value: 36, band: 'medium', unsure: true, reason: '2 of 14 similar reached an interview, 3 still waiting' },
    },
    daysSinceActivity: 9,
    lastActivityAt: '2026-08-31T09:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p4',
    companyName: 'Kestrel Bank',
    roleTitle: 'Platform Engineer',
    status: 'acknowledged',
    // Long enough to be called stale on the card, which is a state the board
    // has to draw and no empty fixture would ever show.
    daysSinceActivity: 21,
    lastActivityAt: '2026-08-19T10:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p5',
    companyName: 'Brightwell',
    roleTitle: 'Senior Engineer, Money Movement',
    status: 'submitted',
    submittedAt: '2026-09-06T18:20:00.000Z',
    confirmationReceivedAt: null,
    daysSinceActivity: 3,
    lastActivityAt: '2026-09-06T18:20:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p6',
    companyName: 'Fennel',
    roleTitle: 'Data Engineer',
    status: 'drafting',
    submittedAt: null,
    confirmationReceivedAt: null,
    excitement: 2,
    daysSinceActivity: 6,
    lastActivityAt: '2026-09-03T12:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p7',
    companyName: 'Marrowby Technology',
    roleTitle: 'Simulation Engineer',
    status: 'lead',
    submittedAt: null,
    confirmationReceivedAt: null,
    source: 'job_board',
    excitement: null,
    daysSinceActivity: 12,
    lastActivityAt: '2026-08-28T08:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p8',
    companyName: 'Quillon Systems UK',
    roleTitle: 'Forward Deployed Engineer',
    status: 'lead',
    submittedAt: null,
    confirmationReceivedAt: null,
    source: 'recruiter_inbound',
    daysSinceActivity: 2,
    lastActivityAt: '2026-09-07T14:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p9',
    companyName: 'Ashgrove Group',
    roleTitle: 'Research Engineer',
    status: 'offer',
    excitement: 5,
    compMinCents: 21000000,
    compMaxCents: 21000000,
    firstHumanResponseAt: '2026-08-20T09:00:00.000Z',
    daysSinceActivity: 0,
    lastActivityAt: '2026-09-08T17:30:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p10',
    companyName: 'Pennyroyal',
    roleTitle: 'Engineering Manager, Core Banking',
    status: 'rejected',
    outcome: 'rejected',
    rejectionStage: 'recruiter_screen',
    closedAt: '2026-08-29T16:00:00.000Z',
    attempt: 2,
    daysSinceActivity: 11,
    lastActivityAt: '2026-08-29T16:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p11',
    companyName: 'Larder',
    roleTitle: 'Staff Engineer',
    status: 'ghosted',
    outcome: 'ghosted',
    daysSinceActivity: 47,
    lastActivityAt: '2026-07-24T10:00:00.000Z',
  }),
];

/** The sent applications still open, which is all the moment demos draw. */
/** The Pipeline narrowed to one source, as the filtered surfaces draw it (plan #1658). */
const FILTERED_PIPELINE_PARAMS = { source: 'portal' };
const FILTERED_PIPELINE = askListFilter('pipeline', FILTERED_PIPELINE_PARAMS)!;
const FILTERED_PIPELINE_LABEL = askListLabel(
  'pipeline',
  filterPipeline(pipelineRows, parsePipeline(FILTERED_PIPELINE_PARAMS)).filtered.length,
);

const momentRows = pipelineRows.filter((row) => OPEN_STATUSES.includes(row.status));

/**
 * A company you have done the reading on: research written, three people on
 * file at different stages of being contacted, one send still unanswered.
 */
const companyPanels = {
  roleCount: 2,
  roles: (
    <CompanyRoles
      companyId="co-1"
      slug="d-e-shaw"
      timezone="Europe/London"
      tasks={[]}
      todos={[
        {
          id: 'rm1',
          body: 'Send Dana the follow-up on the backtester question',
          dueAt: '2026-09-12T09:00:00.000Z',
          role: { id: 'r1', title: 'Senior Software Engineer, Research Platform' },
        },
      ]}
      roles={[
        {
          id: 'r1',
          title: 'Senior Software Engineer, Research Platform',
          location: 'London',
          firstSeenAt: '2026-08-04T09:00:00.000Z',
          applications: [
            { id: 'a1', attempt: 1, status: 'in_process', submittedAt: '2026-08-06T09:00:00.000Z', outcome: null },
          ],
        },
        {
          id: 'r2',
          title: 'Software Engineer, Market Data',
          location: 'New York, NY',
          firstSeenAt: '2025-03-11T09:00:00.000Z',
          applications: [
            { id: 'a2', attempt: 1, status: 'rejected', submittedAt: '2025-03-14T09:00:00.000Z', outcome: 'rejected' },
          ],
        },
      ]}
    />
  ),
  companyId: 'co-1',
  research:
    'Systematic manager, roughly 500 people in London. The research platform team owns the backtester and the data pipeline; the posting is on that team.\n\nThey moved off a vendor risk system in 2024, which is what the "market data at scale" line in the posting is about.',
  domains: 'halloran.example, halloran.co.uk',
  industry: 'Quantitative investment management',
  hqLocation: 'New York, NY',
  careersUrl: 'https://www.halloran.example/careers',
  linkedinUrl: 'https://www.linkedin.com/company/de-shaw',
  website: 'https://www.halloran.example',
  priority: 'high',
  timezone: 'Europe/London',
  contacts: [
    {
      id: 'c1',
      fullName: 'Dana Ruiz',
      title: 'Engineering Manager, Research Platform',
      relationship: 'interviewer',
      status: 'replied',
      linkedinUrl: 'https://www.linkedin.com/in/dana-ruiz',
      email: 'dana.ruiz@halloran.example',
      howWeConnect: 'Ran the phone screen.',
    },
    {
      id: 'c2',
      fullName: 'Priyanka Raghunathan',
      title: 'Technical Recruiter',
      relationship: 'recruiter',
      status: 'contacted',
      linkedinUrl: null,
      email: 'p.raghunathan@halloran.example',
      howWeConnect: null,
    },
    {
      id: 'c3',
      fullName: 'Tom Beale',
      title: null,
      relationship: 'warm_intro',
      status: 'not_contacted',
      linkedinUrl: 'https://www.linkedin.com/in/tom-beale',
      email: null,
      howWeConnect: 'Worked with him at the last place; he knows the platform team.',
    },
  ],
  touches: [
    {
      id: 'tt1',
      channel: 'linkedin_dm',
      direction: 'outbound',
      sentAt: '2026-09-02T11:00:00.000Z',
      respondedAt: null,
      message: 'Asked whether the platform team is still hiring past the one posting.',
      contactName: 'Tom Beale',
    },
    {
      id: 'tt2',
      channel: 'email',
      direction: 'outbound',
      sentAt: '2026-08-21T08:30:00.000Z',
      respondedAt: '2026-08-21T15:12:00.000Z',
      message: 'Thanks for the screen — sent the follow-up note.',
      contactName: 'Dana Ruiz',
    },
  ],
  notes: [
    {
      id: 'n1',
      body: 'Interview loop is four conversations in one day. Ask for the schedule a week out.',
      createdAt: '2026-08-22T09:00:00.000Z',
    },
  ],
};

/**
 * The review queue on a normal morning: two unlinked messages, one of which
 * the matcher is confident about and one it is not, an application it inferred
 * from a confirmation, and an event it could not place.
 */
const reviewRows: ReviewRow[] = [
  {
    kind: 'message',
    id: 'r1',
    subject: 'Your application to Tallow — Backend Engineer, Payments',
    fromAddress: 'no-reply@greenhouse.io',
    threadId: 'thread-tallow-payments',
    replyToAddress: 'careers@tallow.example',
    roleHint: null,
    receivedAt: '2026-09-09T07:41:00.000Z',
    classification: 'confirmation',
    reason: 'Sent by an ATS, and no pursuit on file matches the job id.',
    gmailHref: 'https://mail.google.com/mail/u/0/#inbox/10',
    candidates: [
      {
        applicationId: 'p3',
        label: 'Tallow · Backend Engineer, Payments',
        reason: 'Company and role title both match',
        confidence: 0.91,
      },
      {
        applicationId: 'p5',
        label: 'Brightwell · Senior Engineer, Money Movement',
        reason: 'Same ATS vendor',
        confidence: 0.22,
      },
    ],
    sortAt: '2026-09-09T07:41:00.000Z',
  },
  {
    kind: 'message',
    id: 'r2',
    subject: 'Following up',
    fromAddress: 'kate@thehiringpartners.example',
    // The unplaceable one has neither, which is why the matcher has nothing.
    threadId: null,
    replyToAddress: null,
    roleHint: null,
    receivedAt: '2026-09-08T16:03:00.000Z',
    classification: 'other',
    reason: 'A person wrote it, and nothing in it names a role.',
    gmailHref: 'https://mail.google.com/mail/u/0/#inbox/11',
    candidates: [],
    sortAt: '2026-09-08T16:03:00.000Z',
  },
  {
    kind: 'application',
    id: 'r3',
    applicationId: 'p4',
    roleId: 'role-p4',
    companyName: 'Kestrel Bank',
    companyDomains: ['kestrelbank.example'],
    roleTitle: 'Platform Engineer',
    status: 'acknowledged',
    submittedAt: '2026-08-14T09:00:00.000Z',
    reason: 'Created from a confirmation email. Nobody has confirmed the details.',
    sortAt: '2026-08-14T09:00:00.000Z',
  },
  {
    kind: 'event',
    id: 'r4',
    applicationId: 'p1',
    roleId: 'role-p1',
    companyName: 'Larkspur Vane',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    status: 'in_process',
    eventKind: 'interview_scheduled',
    summary: 'Recorded, but it did not change the status — that would have moved this backwards.',
    occurredAt: '2026-09-08T12:00:00.000Z',
    reason: 'The status it implies is behind the one on file.',
    sortAt: '2026-09-08T12:00:00.000Z',
  },
];

const allRoles: SearchableRole[] = pipelineRows.map((row) => ({
  applicationId: row.applicationId,
  companyName: row.companyName,
  roleTitle: row.roleTitle,
  status: row.status,
  everSubmitted: row.submittedAt !== null,
}));

/**
 * Settings for somebody three weeks in: one inbox connected and scanned, one
 * resume, a couple of senders muted, and an evidence bank with something in it.
 */
const settings = {
  email: 'chris@example.com',
  banner: null,
  gmailConfigured: true,
  appOrigin: 'https://example.com',
  profile: {
    targetTitles: 'Quantitative Developer, Backend Engineer, Platform Engineer',
    excludedIndustries: 'Crypto, Healthcare, Defense',
    searchStartedOn: '2026-07-06',
    ghostThresholdDays: 21,
    showNudges: false,
    preferences: {
      homeLocation: 'London',
      workplaces: ['hybrid', 'remote'] as const,
      salaryFloorCents: 9_000_000,
      companyStages: ['growth', 'late'] as const,
    },
  },
  accounts: [
    {
      id: 'ib1',
      emailAddress: 'chris@example.com',
      status: 'connected',
      lastSyncedAt: '2026-09-09T06:15:00.000Z',
      backfillCompletedAt: '2026-07-07T22:40:00.000Z',
      backfillWindowDays: 180,
      latestBackfill: {
        status: 'completed',
        messagesSeen: 4128,
        error: null,
        finishedAt: '2026-07-07T22:40:00.000Z',
      },
    },
  ],
  excludedSenders: [
    { id: 'x1', domain: 'jobalerts.linkedin.com' },
    { id: 'x2', domain: 'hi.wellfound.com' },
  ],
  careerGoals: [
    {
      id: 'th-3',
      body: 'I want the strategy side of deployment work: sitting with customers, working out what they need, and owning the result. A growth-stage company in New York, hybrid at most three days in. Not crypto.',
      written: '28 Sep 2026',
      edited: '2 Oct 2026',
    },
    {
      id: 'th-1',
      body: 'Leaving EY. Not sure yet whether to stay in finance.',
      written: '6 Jul 2026',
      edited: null,
    },
  ],
};


/**
 * Material for the same person: a question bank with long and unanswered
 * questions across kinds, the two resumes and the evidence bank Settings used
 * to hold, and a writing voice with its own banned phrases.
 */
const material: MaterialProps = {
  part: 'answers',
  kind: null,
  questions: [
    {
      id: 'q1',
      text: 'Why do you want to work at Fieldline, and why this team in particular rather than the wider platform organisation?',
      kind: 'motivation',
      canonicalAnswer:
        'I have spent four years making slow batch systems incremental, and your settlement platform is the same problem at ten times the volume. The platform team owns the part I am best at.',
      timesSeen: 7,
      usedIn: 5,
      approvedAnswer: null,
    },
    {
      id: 'q2',
      text: 'Describe a time you disagreed with a technical decision.',
      kind: 'behavioral',
      canonicalAnswer: null,
      timesSeen: 4,
      usedIn: 2,
      approvedAnswer:
        'We were about to shard the reconciliation tables. I argued for moving the joins into the warehouse first; we did, and sharding was never needed.',
    },
    {
      id: 'q3',
      text: 'Are you authorised to work in the UK?',
      kind: 'logistics',
      canonicalAnswer: 'Yes, without sponsorship.',
      timesSeen: 12,
      usedIn: 11,
      approvedAnswer: null,
    },
    {
      id: 'q4',
      text: 'What is your notice period?',
      kind: 'logistics',
      canonicalAnswer: null,
      timesSeen: 1,
      usedIn: 0,
      approvedAnswer: null,
    },
  ],
  resumes: [
    {
      id: 'cv1',
      label: 'Engineering — 2026',
      isDefault: true,
      notes: 'The one that goes to platform roles.',
      hasText: true,
      hasPdf: true,
    },
    { id: 'cv2', label: 'Quant', isDefault: false, notes: null, hasText: false, hasPdf: false },
  ],
  evidence: [
    {
      id: 'ev1',
      title: 'Cut the nightly close from six hours to forty minutes',
      body: 'Rewrote the settlement reconciliation as an incremental job and moved the joins into the warehouse. The team stopped being paged for it.',
      context: 'Last role, 2025',
      skills: ['Python', 'dbt', 'Postgres'],
      metrics: '6h → 40m, on 40m rows a night',
      strength: 5,
      usedCount: 3,
    },
    {
      id: 'ev2',
      title: 'Took over the on-call rota nobody wanted',
      body: '',
      context: null,
      skills: ['Leadership'],
      metrics: null,
      strength: 2,
      usedCount: 0,
    },
  ],
  voice: {
    writingStyleNotes: 'Plain sentences. No "passionate", no "excited to".',
    bannedConstructions: 'leverage\nsynergy\nreach out',
  },
};

/** Nine people on file, in every state a send to somebody can be in. */
const contactRows: ContactListRow[] = [
  {
    id: 'c1',
    fullName: 'Dana Ruiz',
    title: 'Engineering Manager, Research Platform',
    relationship: 'interviewer',
    status: 'replied',
    companyName: 'The Halloran-Achterberg group',
    companySlug: 'de-shaw',
    lastTouchAt: '2026-08-21T08:30:00.000Z',
    pendingReplies: 0,
  },
  {
    id: 'c2',
    fullName: 'Priyanka Raghunathan',
    title: 'Technical Recruiter',
    relationship: 'recruiter',
    status: 'contacted',
    companyName: 'The Halloran-Achterberg group',
    companySlug: 'de-shaw',
    lastTouchAt: '2026-09-02T11:00:00.000Z',
    pendingReplies: 1,
  },
  {
    id: 'c3',
    fullName: 'Tom Beale',
    title: null,
    relationship: 'warm_intro',
    status: 'not_contacted',
    companyName: 'Tallow',
    companySlug: 'tallow',
    lastTouchAt: null,
    pendingReplies: 0,
  },
  {
    id: 'c4',
    fullName: 'Aoife Ní Bhraonáin',
    title: 'Head of Engineering',
    relationship: 'hiring_manager',
    status: 'contacted',
    companyName: 'Kestrel Bank',
    companySlug: 'kestrel-bank',
    lastTouchAt: '2026-08-30T09:10:00.000Z',
    pendingReplies: 2,
  },
  {
    id: 'c5',
    fullName: 'Sam Okonjo',
    title: 'Staff Engineer',
    relationship: 'friend',
    status: 'replied',
    companyName: null,
    companySlug: null,
    lastTouchAt: '2026-07-19T20:00:00.000Z',
    pendingReplies: 0,
  },
];

const contact: ContactRow = {
  id: 'c4',
  fullName: 'Aoife Ní Bhraonáin',
  title: 'Head of Engineering',
  relationship: 'hiring_manager',
  status: 'contacted',
  linkedinUrl: 'https://www.linkedin.com/in/aoife-ni-bhraonain',
  email: 'aoife@kestrelbank.example',
  howWeConnect: 'Spoke at the same meetup in March; she remembered the talk.',
  notes: 'Owns the platform group. Prefers a short note to a long one.',
  companyName: 'Kestrel Bank',
  companySlug: 'kestrel-bank',
  touches: [
    {
      id: 't1',
      channel: 'linkedin_dm',
      direction: 'outbound',
      sentAt: '2026-08-30T09:10:00.000Z',
      respondedAt: null,
      message: 'Asked whether the platform role is still open after the reorg.',
    },
    {
      id: 't2',
      channel: 'email',
      direction: 'outbound',
      sentAt: '2026-08-12T18:00:00.000Z',
      respondedAt: null,
      message: 'Sent the write-up she asked for at the meetup.',
    },
    {
      id: 't3',
      channel: 'event',
      direction: 'inbound',
      sentAt: '2026-03-04T19:30:00.000Z',
      respondedAt: '2026-03-04T19:30:00.000Z',
      message: 'Met at the London Systems meetup.',
    },
  ],
};

/** People to name as a referrer: one with the longest name, one with no company. */
const referrerFixtures: ReferrerOption[] = [
  { id: 'contact-1', name: 'Alexandra Montgomery-Fitzwilliam', company: 'The Halloran-Achterberg group' },
  { id: 'contact-2', name: 'Priya Raman', company: 'Copperline' },
  { id: 'contact-3', name: 'Sam Okafor', company: null },
];

const knownCompanies = [...new Set(pipelineRows.map((row) => row.companyName))].map((name) => ({
  name,
}));

/**
 * A week with something in every section: two rounds coming up, one of them a
 * superday with no prep written, mail that asked a question a fortnight ago,
 * and two nudges the nightly sweep raised.
 */
const todayBoard: TodayBoard = {
  clear: false,
  interviews: [
    {
      id: 'ti1',
      applicationId: 'p1',
      roleId: 'role-p1',
      companyName: 'Larkspur Vane',
      roleTitle: 'Quantitative Developer, Systematic Strategies',
      scheduledAt: '2026-09-11T13:30:00.000Z',
      timeKnown: true,
      kind: 'technical',
      format: 'video',
      durationMinutes: 60,
      meetingUrl: 'https://meet.example.com/mw-tech',
      location: null,
      hasPrep: true,
      groupId: 'tg1',
      round: { id: 'tg1', roundNumber: 2, label: 'Technical', notes: '' },
    },
    {
      id: 'ti2',
      applicationId: 'p2',
      roleId: 'role-p2',
      companyName: 'The Halloran-Achterberg group',
      roleTitle: 'Software Developer',
      scheduledAt: '2026-09-16T08:00:00.000Z',
      timeKnown: false,
      kind: 'onsite',
      format: 'onsite',
      durationMinutes: null,
      meetingUrl: null,
      location: 'London office',
      hasPrep: false,
      groupId: 'tg2',
      round: { id: 'tg2', roundNumber: 3, label: 'Final', notes: '' },
    },
    {
      id: 'ti3',
      applicationId: 'p2',
      roleId: 'role-p2',
      companyName: 'The Halloran-Achterberg group',
      roleTitle: 'Software Developer',
      scheduledAt: '2026-09-16T10:00:00.000Z',
      timeKnown: false,
      kind: 'hiring_manager',
      format: 'onsite',
      durationMinutes: null,
      meetingUrl: null,
      location: 'London office',
      hasPrep: false,
      groupId: 'tg2',
      round: { id: 'tg2', roundNumber: 3, label: 'Final', notes: '' },
    },
  ],
  waiting: [
    {
      eventId: 'tw1',
      applicationId: 'p3',
      roleId: 'role-p3',
      companyName: 'Tallow',
      roleTitle: 'Backend Engineer, Payments',
      kind: 'question',
      summary: 'Asked for three dates in the week of the 21st and a note on notice period.',
      occurredAt: '2026-08-28T14:20:00.000Z',
    },
  ],
};

/**
 * Today with something in every section (plan #1591): five imports waiting,
 * the two applications closest to an offer, the week, the live applications
 * split by whose move it is, and two changes since the last visit.
 * Halloran-Achterberg is at final round with nothing prepped and yesterday's
 * round owing a debrief, which it asks for in place of This week; Larkspur
 * Vane is in process, prepped for its technical, with the screen's questions
 * on record. Both have interviews booked, so the move is yours; Tallow's mail
 * asked a question, which makes it yours too.
 */
const todayPageNow = new Date('2026-09-09T12:00:00.000Z');
const todayPageRows: PipelineRow[] = pipelineRows.map((row) =>
  row.applicationId === 'p1'
    ? { ...row, lastTurnEvent: 'interview_scheduled' }
    : row.applicationId === 'p2'
      ? { ...row, status: 'final_round', lastTurnEvent: 'interview_scheduled' }
      : row,
);
const todayPageSince: SinceView = {
  state: 'loaded',
  hint: 'Since 8 Sept, 6:40 PM BST',
  stopped: [],
  entries: [
    {
      id: 'ts1',
      at: '2026-09-09T08:10:00.000Z',
      source: 'email',
      label: 'interview booked',
      subject: 'The Halloran-Achterberg group · Software Developer',
      tone: 'good',
      stage: 'in_process',
      detail: null,
      roleId: 'role-p2',
    },
    {
      id: 'ts2',
      at: '2026-09-08T21:30:00.000Z',
      source: 'email',
      label: 'new role',
      subject: 'Brightwell · Software Engineer, Treasury',
      tone: 'info',
      stage: 'lead',
      detail: null,
      roleId: 'role-p5',
    },
  ],
  more: 3,
  error: null,
};

/** Two upcoming rounds and three past ones, one of them still owing a debrief. */
const interviewRounds: RoundView[] = [
  {
    key: 'ir1',
    leadId: 'ti1',
    roleId: 'role-p1',
    companyName: 'Larkspur Vane',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    scheduledAt: '2026-09-11T13:30:00.000Z',
    timeKnown: true,
    endsAt: Date.parse('2026-09-11T14:30:00.000Z'),
    round: 'Round 2 · Technical',
    kind: 'Technical',
    notes: null,
  },
  {
    key: 'ir2',
    leadId: 'ti2',
    roleId: 'role-p2',
    companyName: 'The Halloran-Achterberg group',
    roleTitle: 'Software Developer',
    scheduledAt: '2026-09-16T08:00:00.000Z',
    timeKnown: false,
    endsAt: Date.parse('2026-09-17T00:00:00.000Z'),
    round: 'Round 3 · Final',
    kind: '4 interviews',
    notes: null,
  },
  {
    key: 'ir3',
    leadId: 'ti4',
    roleId: 'role-p1',
    companyName: 'Larkspur Vane',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    scheduledAt: '2026-08-27T09:00:00.000Z',
    timeKnown: true,
    endsAt: Date.parse('2026-08-27T09:45:00.000Z'),
    round: 'Round 1',
    kind: 'Phone screen',
    notes: 'Went well. She asked mostly about the reconciliation rewrite.',
  },
  {
    key: 'ir4',
    leadId: 'ti5',
    roleId: 'role-p10',
    companyName: 'Pennyroyal',
    roleTitle: 'Engineering Manager, Core Banking',
    scheduledAt: '2026-08-25T15:00:00.000Z',
    timeKnown: true,
    endsAt: Date.parse('2026-08-25T15:30:00.000Z'),
    round: null,
    kind: 'Recruiter screen',
    notes: null,
  },
];

/**
 * A month with an ordinary amount in it: a week carrying three things, one
 * square over the dot limit, a couple of finished tasks and a long run of
 * empty days.
 *
 * The empty days are half the reason this surface exists. A calendar is read
 * for the Thursday with nothing on it as much as for the Tuesday with four,
 * and a fixture that fills every square would hide which of the two is drawn
 * badly.
 */
const CALENDAR_MONTH = '2026-09';
const CALENDAR_TODAY = '2026-09-10';

const calendarEntries: Record<string, CalendarEntry[]> = {
  '2026-09-03': [
    {
      key: 'task:c1',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Renew the travel insurance',
      href: null,
      done: true,
    },
  ],
  '2026-09-09': [
    {
      key: 'item:c2',
      kind: 'item',
      at: '2026-09-09T08:30:00.000Z',
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Return window closes — Sony WH-1000XM5',
      href: '/shopping/returns',
      done: false,
    },
  ],
  '2026-09-10': [
    {
      key: 'task:c3',
      kind: 'task',
      at: '2026-09-10T09:00:00.000Z',
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Send the reconciliation write-up to Dana',
      href: null,
      done: false,
    },
    {
      key: 'context:c4',
      kind: 'context',
      at: '2026-09-10T13:30:00.000Z',
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Dentist',
      href: null,
      done: false,
    },
    {
      key: 'task:c5',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Book the flights',
      href: null,
      done: false,
    },
  ],
  '2026-09-11': [
    {
      key: 'item:c6',
      kind: 'item',
      at: '2026-09-11T13:30:00.000Z',
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Larkspur Vane · Technical',
      href: '/jobs/roles/role-p1',
      done: false,
    },
  ],
  '2026-09-16': [
    {
      key: 'item:c7',
      kind: 'item',
      at: '2026-09-16T08:00:00.000Z',
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'The Halloran-Achterberg group · Final',
      href: '/jobs/roles/role-p2',
      done: false,
    },
    {
      key: 'task:c8',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Write the prep note',
      href: null,
      done: false,
    },
    {
      key: 'task:c9',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Chase the take-home feedback',
      href: null,
      done: false,
    },
    {
      key: 'task:c10',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Cancel the trial',
      href: null,
      done: false,
    },
    // Five in one square, which is where the phone stops drawing dots and says
    // how many are left. A state no tidy fixture would ever produce.
    {
      key: 'task:c11',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Order the bike part',
      href: null,
      done: false,
    },
  ],
  '2026-09-24': [
    {
      key: 'task:c12',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Quarterly tax payment',
      href: null,
      done: false,
    },
  ],
  '2026-10-01': [
    {
      key: 'task:c13',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      feedEventId: null,
      title: 'Rent',
      href: null,
      done: false,
    },
  ],
};

const calendarDays: CalendarDay[] = monthDays(CALENDAR_MONTH).map((day) => ({
  day,
  inMonth: monthOf(day) === CALENDAR_MONTH,
  isToday: day === CALENDAR_TODAY,
  entries: calendarEntries[day] ?? [],
}));

/**
 * A note somebody actually wrote: frontmatter, headings, a list, a table, a
 * quote, a fenced block and a link.
 *
 * Every one of those is a different rule in the vault's prose styles, and the
 * styles are the whole surface -- there is no chrome here to look at. A note
 * of three paragraphs would say nothing about the ones that carry structure.
 */
/**
 * A note that embeds one of everything the note page tells apart (plan #1302).
 * The pictures are drawn as SVG data URLs so the gallery needs no storage.
 */
const attachmentRows: AttachmentEntry[] = [
  { id: 'beach', path: 'Attachments/Beach day.png', sizeBytes: 812_000, mimeType: 'image/png', storagePath: 'u/c/beach' },
  { id: 'plan', path: 'Attachments/floor-plan.jpg', sizeBytes: 240_000, mimeType: 'image/jpeg', storagePath: 'u/c/plan' },
  { id: 'lease', path: 'Money/lease.pdf', sizeBytes: 380_000, mimeType: 'application/pdf', storagePath: 'u/c/lease' },
  { id: 'memo', path: 'Audio/voice memo.m4a', sizeBytes: 2_100_000, mimeType: 'audio/mp4', storagePath: 'u/c/memo' },
  { id: 'scan', path: 'Scans/tax-return.pdf', sizeBytes: 61_000_000, mimeType: 'application/pdf', storagePath: null },
  { id: 'receipt', path: 'Attachments/receipt.webp', sizeBytes: 90_000, mimeType: 'image/webp', storagePath: null },
];

function pictureUrl(width: number, height: number, sky: string, ground: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${sky}"/><rect y="${Math.round(height * 0.62)}" width="100%" height="100%" fill="${ground}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const attachmentPictures: Record<string, string> = {
  beach: pictureUrl(1600, 900, '#9cc7e4', '#e8d3a3'), /* ui-ok: the photo's own colours, not the app's */
  plan: pictureUrl(1200, 800, '#f2f2ee', '#c9c9c2'), /* ui-ok: the floor plan's own colours, not the app's */
  lease: '#',
  memo: '#',
};

const attachmentNote = `The flat on Harbour Road, from the viewing on Saturday.

![[Beach day.png]]

The floor plan the agent sent, at the size I keep it in Obsidian:

![[floor-plan.jpg|300]]

The lease to sign: ![[lease.pdf]]

What the landlord said about the deposit:

![[voice memo.m4a]]

![[gone.png]]

![[tax-return.pdf]]

![[receipt.webp]]

![[sketch.svg]]
`;

const noteFrontmatter: Record<string, unknown> = {
  tags: ['postgres', 'ops'],
  status: 'in progress',
  updated: '2026-08-30',
  source: 'https://www.postgresql.org/docs/16/routine-vacuuming.html',
};

const noteMarkdown = `The nightly close was six hours and most of it was one query. Writing down
what actually fixed it, because I will not remember in a year.

## What was slow

The reconciliation join scanned the whole ledger every night, and the ledger
grows. Nothing was wrong with the plan — there was just more of it each week.

- The join key was indexed, and the index was being used.
- The table had not been vacuumed since the bulk load in March.
- Autovacuum was running, and giving up: \`autovacuum_vacuum_cost_limit\` was
  still at the default.

## What it costs now

| Step | Before | After |
| --- | --- | --- |
| Extract | 40m | 38m |
| Reconcile | 4h 50m | 22m |
| Publish | 30m | 28m |

> Do not tune the query before you have looked at whether the table is a
> swamp. I lost a day to a rewrite that changed nothing.

The incremental version keeps a watermark per source and only reads what moved:

\`\`\`sql
select *
from ledger
where updated_at > (select watermark from sync_state where source = 'bank')
order by updated_at;
\`\`\`

Next: work out whether the same trick applies to the settlement file, which is
[the other slow one](https://example.com/runbooks/settlement).
`;

/**
 * A track part way through: two read, one on the shelf now, one queued with a
 * verified chapter, one the app has only guessed at, and one with no source
 * found at all.
 *
 * The guessed locator and the missing source are the point. They are what this
 * module is for and the two states a hand-drawn fixture never includes.
 */
const readingRow = (
  row: Partial<ReadingRow> & Pick<ReadingRow, 'id' | 'position' | 'status' | 'subject'>,
): ReadingRow => ({
  title: null,
  why: null,
  note: null,
  locatorKind: 'chapter',
  locatorLabel: null,
  locatorBasis: 'stated',
  locatorConfidence: 'verified',
  openUrl: null,
  textAnchor: null,
  pageFrom: null,
  pageTo: null,
  tStartSeconds: null,
  tEndSeconds: null,
  finishedAt: null,
  readNowAt: null,
  givenText: null,
  summary: null,
  conceptId: null,
  newsStoryId: null,
  source: null,
  ...row,
});

/**
 * A subject's chain, with the doors in it. Four concepts is what one goal
 * leaves standing; the point of the surface is the two groups and the size
 * difference between them.
 */
const subjectConcepts: Concept[] = [
  {
    id: 'k1',
    name: 'Opportunity cost',
    claim:
      'A choice costs you the next best thing you could have done with the same time or money, whether or not any of it changed hands.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Standard in any first-year sequence, and the one the rest of the chain rests on.',
    kind: 'threshold',
    state: 'shaky',
    established: 'tested',
    misconception: null,
    mastery: [],
    testedAt: '2026-09-02T09:00:00.000Z',
    declaredAt: null,
  },
  {
    id: 'k2',
    name: 'Marginal thinking',
    claim:
      'The question is always what one more unit costs and returns, not what the whole activity is worth on average.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Named in the goal, and every model after it assumes you have it.',
    kind: 'threshold',
    state: 'unknown',
    established: 'inferred',
    misconception: null,
    mastery: [],
    testedAt: null,
    declaredAt: null,
  },
  {
    id: 'k3',
    name: 'Sunk cost',
    claim:
      'Money already spent is not a reason to continue, because it is gone under either choice.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Follows from opportunity cost once the counterfactual is the comparison.',
    kind: 'consequence',
    state: 'misconception',
    established: 'tested',
    misconception: 'You treat the amount already spent as part of what continuing is worth.',
    mastery: [],
    testedAt: '2026-09-05T18:30:00.000Z',
    declaredAt: null,
  },
  {
    id: 'k4',
    name: 'Deadweight loss',
    claim:
      'A tax that changes behaviour destroys trades that both sides wanted, and that loss goes to nobody.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Inferred from the goal, not checked against a syllabus.',
    kind: 'consequence',
    state: 'unknown',
    established: 'inferred',
    misconception: null,
    mastery: [],
    testedAt: null,
    declaredAt: null,
  },
];

/** Vault notes for the working rows surface; the second has a run on it, named by path as a goal's context names it. */
const workingNotes = [
  {
    id: 'wn1',
    path: 'Work/Interview notes, Halloran-Achterberg.md',
    title: 'Interview notes, Halloran-Achterberg',
    excerpt: 'Second round with the platform team. They asked about the replication lag incident twice.',
  },
  {
    id: 'wn2',
    path: 'Work/What I want from the next role.md',
    title: 'What I want from the next role',
    excerpt: 'A team that owns its own on-call, a manager who writes things down, and no more than two days in the office.',
  },
  { id: 'wn3', path: 'Work/Salary bands.md', title: 'Salary bands', excerpt: null },
];

/** Newsletter issues for the working rows surface; the first has a run on it. */
const workingSenders = new Map([
  ['ws1', { id: 'ws1', email: 'hello@moneystuff.example', name: 'Money Stuff', muted: false }],
  ['ws2', { id: 'ws2', email: 'editor@thedispatch.example', name: 'The Morning Dispatch from the Engineering Desk', muted: false }],
]);
const workingIssues = [
  {
    id: 'wi1',
    senderId: 'ws1',
    subject: 'The bond market is pricing in two more cuts, and why the curve disagrees',
    receivedAt: '2026-10-15T06:40:00.000Z',
    readAt: null,
    summaryLine: 'Rate cuts, a fund that gated withdrawals, and a lawsuit over a rounding error.',
  },
  {
    id: 'wi2',
    senderId: 'ws2',
    subject: 'Postgres 18 ships asynchronous I/O',
    receivedAt: '2026-10-14T17:05:00.000Z',
    readAt: '2026-10-14T19:00:00.000Z',
    summaryLine: null,
  },
];

const trackReadings: ReadingRow[] = [
  readingRow({
    id: 'rd1',
    position: 1,
    status: 'read',
    subject: 'Designing Data-Intensive Applications',
    locatorLabel: 'Chapter 5, Replication',
    pageFrom: 151,
    pageTo: 197,
    finishedAt: '2026-08-18T20:10:00.000Z',
    openUrl: 'https://dataintensive.net',
    source: {
      id: 's1',
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      kind: 'book',
      year: 2017,
      canonicalUrl: 'https://dataintensive.net',
      access: 'purchase',
      priceCents: 4199,
      pageCount: 616,
    },
  }),
  readingRow({
    id: 'rd2',
    position: 2,
    status: 'reading',
    subject: 'Jepsen: PostgreSQL 12.3',
    why: 'The failure modes are the part nobody writes down.',
    readNowAt: '2026-09-09T19:00:00.000Z',
    openUrl: 'https://jepsen.io/analyses/postgresql-12.3',
    locatorKind: 'section',
    locatorLabel: 'Serializable snapshot isolation',
    source: {
      id: 's2',
      title: 'PostgreSQL 12.3',
      author: 'Kyle Kingsbury',
      kind: 'report',
      year: 2020,
      canonicalUrl: 'https://jepsen.io/analyses/postgresql-12.3',
      access: 'open',
      priceCents: null,
      pageCount: null,
    },
  }),
  readingRow({
    id: 'rd3',
    position: 3,
    status: 'queued',
    subject: 'Routine vacuuming',
    locatorLabel: 'Chapter 25.1',
    locatorBasis: 'inferred',
    locatorConfidence: 'unverified',
    openUrl: 'https://www.postgresql.org/docs/16/routine-vacuuming.html',
    source: {
      id: 's3',
      title: 'PostgreSQL 16 documentation',
      author: null,
      kind: 'documentation',
      year: 2023,
      canonicalUrl: 'https://www.postgresql.org/docs/16/',
      access: 'open',
      priceCents: null,
      pageCount: null,
    },
  }),
  readingRow({
    id: 'rd4',
    position: 4,
    status: 'queued',
    subject: 'The paper about hybrid logical clocks somebody mentioned at the meetup',
    why: 'Came up twice in a week. Find out whether it is the same thing as a vector clock.',
  }),
  readingRow({
    id: 'rd5',
    position: 5,
    status: 'abandoned',
    subject: 'Transaction Processing: Concepts and Techniques',
    note: 'Too much of it is about hardware nobody runs. Kept chapter 7 and gave up on the rest.',
    source: {
      id: 's5',
      title: 'Transaction Processing: Concepts and Techniques',
      author: 'Jim Gray and Andreas Reuter',
      kind: 'book',
      year: 1992,
      canonicalUrl: null,
      access: 'library',
      priceCents: null,
      pageCount: 1070,
    },
  }),
];

type SampleOrder = {
  id: string;
  merchant: string;
  month: string;
  monthLabel: string;
  person: string;
  number: string;
  inbox: string;
  items: string;
  totalCents: number;
};

const sampleOrders: SampleOrder[] = [
  {
    id: 'o1',
    merchant: 'Zatu Games',
    month: '2026-09',
    monthLabel: 'September 2026',
    person: 'Chris',
    number: 'ZT-88213',
    inbox: 'shop+zatu@…',
    items: 'Brass Birmingham, Ark Nova',
    totalCents: 11250,
  },
  {
    id: 'o2',
    merchant: 'Amazon',
    month: '2026-09',
    monthLabel: 'September 2026',
    person: 'Chris',
    number: '206-4471928',
    inbox: 'shop+amazon@…',
    items: 'USB-C cable, two of them',
    totalCents: 1899,
  },
  {
    id: 'o3',
    merchant: 'Waterstones',
    month: '2026-08',
    monthLabel: 'August 2026',
    person: 'Ana',
    number: 'WS-70119',
    inbox: 'shop+waterstones@…',
    items: 'The Mars Room',
    totalCents: 899,
  },
  {
    id: 'o4',
    merchant: 'Zatu Games',
    month: '2026-08',
    monthLabel: 'August 2026',
    person: 'Chris',
    number: 'ZT-87004',
    inbox: 'shop+zatu@…',
    items: 'Sleeves, 200',
    totalCents: 2400,
  },
];

const orderDisplay: ListDisplaySpec<SampleOrder> = {
  pathname: '/preview',
  sorts: [
    { id: 'newest', label: 'Newest', compare: (a, b) => b.month.localeCompare(a.month) },
    { id: 'oldest', label: 'Oldest', compare: (a, b) => a.month.localeCompare(b.month) },
    {
      id: 'total_desc',
      label: 'Total: high to low',
      compare: (a, b) => b.totalCents - a.totalCents,
    },
    {
      id: 'total_asc',
      label: 'Total: low to high',
      compare: (a, b) => a.totalCents - b.totalCents,
    },
  ],
  groups: [
    {
      id: 'month',
      label: 'Month',
      order: 'key-desc',
      bucket: (row) => ({ key: row.month, label: row.monthLabel }),
    },
    {
      id: 'merchant',
      label: 'Merchant',
      bucket: (row) => ({ key: row.merchant, label: row.merchant }),
    },
    {
      id: 'person',
      label: 'Whose order',
      bucket: (row) => ({ key: row.person, label: row.person }),
    },
  ],
  properties: [
    { id: 'merchant', label: 'Merchant', alwaysOn: true },
    { id: 'number', label: 'Order number' },
    { id: 'inbox', label: 'Inbox address' },
    { id: 'person', label: 'Whose order' },
    { id: 'items', label: 'What was in it' },
  ],
  defaultSort: 'newest',
  defaultGroup: 'month',
};

const orderDisplayParams = {
  s: 'shell-display-options',
  sort: 'total_desc',
  hide: 'inbox',
};

/**
 * A thread on a plan step: a question of yours and the answer under it.
 *
 * The answer is long and has a list, a link and a block of code in it, because
 * that is what a session writes back and it is the shape the thread has to lay
 * out -- an answer that happens to be one short paragraph proves nothing. The
 * times are counted back from now rather than written down, so the surface
 * keeps showing what a thread looks like this week instead of one from
 * whenever the fixture was typed.
 */
const commentThread: DevComment[] = [
  {
    id: 'fixture-1',
    author: 'me',
    body: "@dash the Dash's view is showing #412 and I never handed it over. Is the filter reading the row or the tree?",
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fixture-2',
    author: 'claude',
    body: `The filter reads \`assignee\` off the row itself. The tree only rolls it up for the counts in the strip at the top of the page, so the view and the count can disagree and neither is wrong.

#412 is there because approving a step is what puts it in that view -- nothing has to be handed over separately:

- \`handStepToClaude\` sets the assignee on the step it was pressed on.
- The runner's list is \`workOrder\`, which leaves out decisions and anything already closed.
- The badge on the row is the column and nothing else, which is why it appears on rows you did not press anything on.

If you want the child back, take it back from its own menu -- that writes the column on that one row and leaves the parent alone:

\`\`\`ts
const ready = workOrder(sections, { assignee: 'claude' });
\`\`\`

The rule is written down in [the plan spec](https://example.com/docs/PLAN-SPEC.md), under how a feature is worked. Anything pasted in, <b>markup included</b>, is shown as the text it is.`,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  },
  {
    /* Two from Dash in a row: the answer, and then what the session that read
     * the code did about it. The pair is here because a run from one author is
     * what the shared header has to be looked at on. */
    id: 'fixture-3',
    author: 'claude',
    body: 'Reworded the done-when on #412 to say the count and the view are read off different things, and put the old wording in the thread on that step.',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fixture-4',
    author: 'me',
    body: '@dash take #412 back off Dash then, and leave the feature where it is.',
    createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
];

function SharedDisplayOptions() {
  const state = parseListDisplay(orderDisplay, orderDisplayParams);
  const groups = groupRows(sortRows(sampleOrders, state), state.groupBy, (rows) =>
    formatMoney(rows.reduce((sum, row) => sum + row.totalCents, 0)),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <DisplayMenu menu={listDisplayMenu(orderDisplay, orderDisplayParams)} />
      </div>
      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          <GroupHeader label={group.label} count={group.count} subtotal={group.subtotal} />
          <ul
            className={cn(
              cardVariants({ padding: 'none' }),
              'divide-y divide-border overflow-hidden',
            )}
          >
            {group.rows.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-ui text-ink">
                    {row.merchant}
                    {!isHidden(state, 'number') && (
                      <span className="ml-2 text-small text-ink-muted">{row.number}</span>
                    )}
                  </p>
                  {!isHidden(state, 'items') && (
                    <p className="truncate text-small text-ink-muted">{row.items}</p>
                  )}
                  {!isHidden(state, 'inbox') && (
                    <p className="truncate text-small text-ink-ghost">{row.inbox}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-ui text-ink">{formatMoney(row.totalCents)}</p>
                  {!isHidden(state, 'person') && (
                    <p className="text-small text-ink-muted">{row.person}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * A newsletter issue as /news/i/[id] draws it (plan #788). A weekly roundup
 * with four stories: the first leads with a picture, one headline is a single
 * long unbroken word, the way a link-roundup names a repository, and two
 * stories carry no link.
 */
const issueBase: IssueViewProps = {
  issueId: 'issue-1',
  subject: 'The Week in Infrastructure #212: queues, caches and one bad deploy',
  byline: 'Infra Weekly · Tue 22 Sep, 7:14\u00a0AM',
  back: { href: '/news/all', label: 'Newsletters' },
  digest: {
    summary:
      'A quieter week for launches and a busy one for post-mortems. The lead piece walks through how a payments company lost six hours to a cache that kept serving stale balances after a failover, and what they changed. Elsewhere: a benchmark of three Postgres-backed job queues, a new release of a popular tracing library, and a short essay on why most teams do not need Kubernetes yet.',
    stories: [
      {
        headline: 'Six hours of stale balances: a failover post-mortem',
        summary:
          "A replica promoted during a network partition kept its warm cache, so reads served balances from before the split. The fix was to tie cache generations to the primary's timeline ID rather than to wall-clock expiry.",
        link: 'https://example.com/blog/2026/09/stale-balances-post-mortem',
        // Drawn inline so the gallery needs no network for it, and wide
        // because the lead story spreads it across the card (plan #856).
        image:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 160'%3E%3Crect width='320' height='160' fill='%23334155'/%3E%3Cpath d='M0 118 L70 70 L130 104 L190 62 L250 96 L320 74 V160 H0Z' fill='%2394a3b8'/%3E%3Ccircle cx='236' cy='40' r='16' fill='%23fbbf24'/%3E%3C/svg%3E",
        text: "At 02:14 a network partition split the primary from two of its replicas. The failover promoted one of them within forty seconds, which is what it is meant to do.\n\nWhat nobody had planned for was the cache in front of it. Its keys expired on a timer, not on a change of primary, so for six hours it went on serving balances written before the split.\n\nThe fix ties each cache generation to the primary's timeline ID. A promotion now empties the cache on the spot.",
      },
      {
        headline: 'github.com/example-org/postgres-backed-job-queue-benchmarks-2026',
        summary:
          'Three queues built on SKIP LOCKED were run at the same load for a week. The simplest one held its latency best, and the one with the most features fell over first when vacuum could not keep up.',
        link: 'https://github.com/example-org/postgres-backed-job-queue-benchmarks-2026',
      },
      {
        headline: 'Tracing library 4.0 drops the global registry',
        summary:
          "Every tracer is now passed explicitly, which breaks most existing setups. The maintainers say the upgrade is a morning's work for a typical service.",
      },
      {
        headline: 'You probably do not need Kubernetes yet',
        summary:
          'An essay arguing that a team under twenty engineers spends more on the platform than it saves. Its test is whether anyone on the team would notice a week without it.',
      },
    ],
  },
  digestError: null,
  showDigest: true,
  html: null,
  textBody: null,
  pictures: true,
  pictureCount: 1,
  blockedImages: 0,
  unsubscribeUrl: 'https://example.com/unsubscribe?u=abc123',
  picturesHref: '/news/i/issue-1?pictures=0',
  originalHref: '/news/i/issue-1?view=original',
  summaryHref: '/news/i/issue-1',
  // One story saved, so the gallery shows Save and Saved side by side (plan #869).
  savedHeadlines: ['Tracing library 4.0 drops the global registry'],
};

/** A single-essay newsletter: the summary is the whole digest. */
const issueEssay: IssueViewProps = {
  ...issueBase,
  issueId: 'issue-2',
  subject: 'On leaving things unfinished',
  byline: 'Slow Letters · Sun 20 Sep, 9:02\u00a0AM',
  digest: {
    summary:
      "An essay about the half-built projects that pile up in any maker's life, and the argument that abandoning one on purpose is a skill. The writer keeps a list of what they stopped and why, and rereads it before starting anything new. Their point is that the list is less about guilt than about noticing which kinds of project they never finish.",
    stories: [],
  },
  unsubscribeUrl: null,
};

/**
 * A signup email waiting on its Confirm button (plan #1724): the original
 * email under the button, with a confirmation address long enough to show the
 * button never prints it.
 */
const issueSignup: IssueViewProps = {
  ...issueBase,
  digest: null,
  showDigest: false,
  issueId: 'issue-4',
  subject: 'Please confirm your subscription to The Slow Letter',
  byline: 'The Slow Letter · Sat 10 Oct, 9:38 AM',
  html: '<p>Thanks for signing up. One last step: press the button below to confirm that this address is yours.</p><p><a href="https://example.com/confirm">Confirm my subscription</a></p><p>If you did not sign up, ignore this email and nothing will happen.</p>',
  pictures: true,
  pictureCount: 0,
  blockedImages: 0,
  unsubscribeUrl: null,
  confirm: {
    url: 'https://slowletter.example.com/subscribe/confirm?token=9f2c61d0a7b34e58b1c4d7e0f3a96b25&list=weekly',
    confirmedLabel: null,
  },
};

/** A newsletter whose digest failed: the email as it arrived, with one line above it. */
const issueFailed: IssueViewProps = {
  ...issueBase,
  issueId: 'issue-3',
  subject: 'Market notes for Monday',
  byline: 'Morning Tape · Mon 21 Sep, 6:30\u00a0AM',
  digest: null,
  digestError: 'model returned no summary',
  showDigest: false,
  html: '<h2>Good morning</h2><p>Futures are flat ahead of the open. Three things to watch today: the jobs revision, two earnings reports after the close, and whether the long end keeps selling off.</p><p><img src="https://example.com/chart.png" alt="Chart of the ten-year yield"></p><p>That is it for today.</p>',
  pictures: false,
  pictureCount: 1,
  blockedImages: 1,
  picturesHref: '/news/i/issue-3',
};

/**
 * The Quick read card (plan #851): the lead story of the roundup above, with
 * its picture and its text folded under the summary, three more to come.
 */
/** Two of your notes on a story's subject (plan #1113), as the lookup returns them. */
const previewRelatedNotes = [
  {
    noteId: 'note-related-1',
    title: 'Failover drills we never ran',
    href: '/vault/n/Work/Failover%20drills%20we%20never%20ran.md',
  },
  {
    noteId: 'note-related-2',
    title: 'On replication lag',
    href: '/vault/n/Ideas/On%20replication%20lag.md',
  },
];

/**
 * The bottom padding AppShell's main keeps for the tab bar below lg, for the
 * Quick read entries drawn without the shell: the Next row is fixed above
 * where the tab bar would be, and this lets the card's foot scroll clear of
 * it as it does in the app.
 */
const SHELL_FOOT = 'pb-[calc(var(--dock-h)+2.125rem)] lg:pb-0';

const quickStory: QuickReadViewProps = {
  card: {
    kind: 'story',
    story: issueBase.digest!.stories[0],
    issueId: 'issue-1',
    storyIndex: 0,
    subject: issueBase.subject,
    receivedAt: '2026-09-22T07:14:00Z',
    sender: {
      id: 'sender-1',
      email: 'hello@infraweekly.example',
      name: 'Infra Weekly',
      muted: false,
    },
    from: 'Infra Weekly',
    remainingInIssue: 4,
    alsoIn: [
      { issueId: 'issue-4', from: 'Morning Tape' },
      { issueId: 'issue-5', from: 'Local Brief' },
    ],
    repeats: [],
    reason: 'Ran in 3 of your newsletters',
    rating: 81,
  },
  arrived: '22 Sep, 7:14\u00a0AM',
  nothingYet: false,
  related: previewRelatedNotes,
  pictures: true,
  picturesHref: '/news?pictures=0',
  issueHref: '/news/i/issue-1',
  seed: 'preview:2026-09-23:news',
  topics: {
    topics: ['Politics', 'Business', 'Technology', 'Culture'],
    selected: null,
    hrefs: {
      Politics: '/news?topic=Politics',
      Business: '/news?topic=Business',
      Technology: '/news?topic=Technology',
      Culture: '/news?topic=Culture',
    },
    allHref: '/news',
  },
};

/** A single-essay newsletter as one card: its subject and its summary, no picture. */
const quickEssay: QuickReadViewProps = {
  ...quickStory,
  related: null,
  card: {
    kind: 'essay',
    summary: issueEssay.digest!.summary,
    issueId: 'issue-2',
    storyIndex: 0,
    subject: issueEssay.subject,
    receivedAt: '2026-09-20T09:02:00Z',
    sender: { id: 'sender-2', email: 'letters@slow.example', name: 'Slow Letters', muted: false },
    from: 'Slow Letters',
    remainingInIssue: 1,
    alsoIn: [],
    repeats: [],
    reason: null,
  },
  arrived: '20 Sep, 9:02\u00a0AM',
  issueHref: '/news/i/issue-2',
};

/**
 * Quick read on a laptop (plan #941): the story card above leading a page with
 * the essay beside it. Below md the gallery shows the single card instead.
 */
const quickPageView: QuickReadViewProps = {
  ...quickStory,
  page: [
    {
      card: quickStory.card!,
      arrived: '22 Sep, 7:14\u00a0AM',
      saved: false,
      related: previewRelatedNotes,
      issueHref: '/news/i/issue-1',
    },
    {
      card: quickEssay.card!,
      arrived: '20 Sep, 9:02\u00a0AM',
      saved: false,
      issueHref: '/news/i/issue-2',
    },
  ],
};

/** A picture drawn inline, so the gallery needs no network for it. */
function previewPicture(sky: string, hill: string): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'%3E%3Crect width='320' height='180' fill='%23${sky}'/%3E%3Cpath d='M0 130 L80 84 L150 116 L220 70 L320 104 V180 H0Z' fill='%23${hill}'/%3E%3C/svg%3E`;
}

/**
 * A page of the News grid (plan #940): six stories from four newsletters, as
 * Quick read fills a page. Three carry a picture and three do not, the way a
 * page mixes newsletters summarised before and after pictures were kept. One
 * headline is a single long word, and one summary runs long.
 */
const gridStories: GridStory[] = [
  {
    key: 'issue-1:0',
    headline: issueBase.digest!.stories[0].headline,
    summary: issueBase.digest!.stories[0].summary,
    image: issueBase.digest!.stories[0].image,
    from: 'Infra Weekly',
    rating: 81,
    link: issueBase.digest!.stories[0].link,
    body: (
      <StoryText
        text={issueBase.digest!.stories[0].text}
        summary={issueBase.digest!.stories[0].summary}
      />
    ),
  },
  {
    key: 'issue-4:0',
    headline: 'Rail freight volumes rise for a third month',
    summary:
      'Container traffic on the main northern routes is up nine percent on last year, mostly from ports diverting cargo away from congested motorways.',
    image: previewPicture('1e3a8a', '60a5fa'),
    from: 'The Morning Ledger',
    rating: 58,
    link: 'https://example.com/ledger/rail-freight',
  },
  {
    key: 'issue-1:1',
    headline: issueBase.digest!.stories[1].headline,
    summary: issueBase.digest!.stories[1].summary,
    from: 'Infra Weekly',
    link: issueBase.digest!.stories[1].link,
  },
  {
    key: 'issue-5:0',
    headline: 'A museum reopens its print room after four years',
    summary:
      'The collection of eighteenth-century engravings is back on view by appointment, with a new reading room and a catalogue that is online for the first time. The curators have added a short guide to the printing methods behind each plate, and the first two months of slots were gone within a day.',
    from: 'Culture Desk',
  },
  {
    key: 'issue-6:0',
    headline: 'Council votes to keep the late-night bus routes',
    summary:
      'The three routes were due to be cut in January. A funding deal with two neighbouring boroughs keeps them running for another two years.',
    image: previewPicture('7c2d12', 'fb923c'),
    from: 'Local Brief',
    link: 'https://example.com/local/night-buses',
  },
  {
    key: 'issue-1:2',
    headline: issueBase.digest!.stories[2].headline,
    summary: issueBase.digest!.stories[2].summary,
    from: 'Infra Weekly',
  },
];

/**
 * A full laptop page of Quick read (note a5a59857): five stories, every one
 * with a picture, the case that has to fit a laptop screen without scrolling.
 */
const quickFullPage: QuickReadViewProps = {
  ...quickStory,
  page: gridStories.slice(0, 5).map((story, index) => {
    const from = story.from ?? 'Infra Weekly';
    return {
      card: {
        kind: 'story' as const,
        story: {
          headline: story.headline,
          summary: story.summary,
          image: previewPicture(
            ['1e3a8a', '7c2d12', '14532d', '4c1d95', '713f12'][index],
            '93c5fd',
          ),
          link: 'https://example.com/story',
          text: index === 0 ? issueBase.digest!.stories[0].text : undefined,
          topic: 'Business' as const,
        },
        issueId: `issue-${index + 1}`,
        storyIndex: 0,
        subject: issueBase.subject,
        receivedAt: '2026-09-22T07:14:00Z',
        sender: { id: `sender-${index + 1}`, email: 'hello@example.com', name: from, muted: false },
        from,
        remainingInIssue: 1,
        alsoIn: index === 0 ? [{ issueId: 'issue-9', from: 'Morning Tape' }] : [],
        repeats: [],
        reason: null,
      },
      arrived: '22 Sep, 7:14\u00a0AM',
      saved: false,
      issueHref: `/news/i/issue-${index + 1}`,
    };
  }),
};

/**
 * The Saved tab (plan #870): three stories, newest saved first. The first has
 * its picture, full text and link; the second's newsletter has been deleted,
 * so its sender is not a link; the third has no link or text of its own.
 */

/**
 * A full evening's review (plan #1616): the overview, ten stories and the
 * local one, with the longest line the model is allowed and events several
 * newsletters ran. Earlier days exist, so the back arrow is live and the
 * forward one, on the latest day, is not.
 */
const reviewLines: [string, number][] = [
  ['The rail strike planned for Thursday was called off at midnight after the union accepted a revised pay offer worth 5% over two years.', 4],
  ['The Bank of England held rates at 4.75% and signalled one cut before the end of the year.', 3],
  ['Wildfires north of Athens forced 12,000 people from their homes as winds picked up overnight.', 2],
  ['A new study finds four-day-week trials kept output steady at 61 firms.', 1],
  ['Apple delayed its smart-home display to next spring.', 2],
  ['EU ministers agreed a common line on asylum returns after a nine-hour meeting.', 1],
  ['The Met Office warned of the wettest October week in a decade for the south west.', 1],
  ['Chip shares fell after export rules on advanced processors were tightened again.', 1],
  ['A transfer window record: three clubs each spent over £200m.', 1],
  ['NASA set a new date in March for the next crewed Moon flyby.', 1],
];

const reviewFull: ReviewViewProps = {
  review: {
    dayLabel: 'Tuesday 6 October',
    writtenAt: '8:04\u00a0PM',
    overview:
      'A quieter day for markets and a busy one for transport. The rail strike that would have shut most lines on Thursday is off, the Bank of England held rates, and wildfires in Greece were the main story abroad. Closer to home, the council approved the new cycle lanes on Mill Road.',
    lines: [
      ...reviewLines.map(([line, sources], i) => ({
        issueId: `issue-${i + 1}`,
        storyIndex: i % 3,
        href: `/news/i/issue-${i + 1}/s/${i % 3}?from=review`,
        line,
        sources,
      })),
      {
        issueId: 'issue-local',
        storyIndex: 2,
        href: '/news/i/issue-local/s/2?from=review',
        line: 'The council approved protected cycle lanes on Mill Road, with work starting in January.',
        sources: 1,
        local: true,
      },
    ],
  },
  earlier: { href: '/news/review?day=2026-10-05', label: 'Mon 5 Oct' },
  later: null,
  todayAt: null,
};

/* The newsletter list's Needs confirming section (plan #1725): three waiting
 * signups, one with a long name and an address in place of a name. */
const waitingSenders = new Map(
  [
    { id: 's1', email: 'hello@theweekly.example', name: 'The Weekly Digest of Slow Technology and Long Reading', muted: false },
    { id: 's2', email: 'letters@fieldnotes.example', name: null, muted: false },
    { id: 's3', email: 'news@harbour.example', name: 'Harbour Post', muted: false },
  ].map((sender) => [sender.id, sender] as const),
);

function NeedsConfirmingSurface() {
  return (
    // The top of the All newsletters page as it draws now (plan #1774).
    <PageColumn className="space-y-4">
      <PageHeader title="Newsletters" />
      <NeedsConfirming
        timezone="Europe/London"
        senders={waitingSenders}
        signups={[
          { id: 'w1', senderId: 's3', subject: 'Confirm your subscription', receivedAt: '2026-10-10T08:12:00Z', confirmUrl: 'https://harbour.example/confirm?t=abc' },
          { id: 'w2', senderId: 's2', subject: 'Please confirm', receivedAt: '2026-10-08T17:40:00Z', confirmUrl: 'https://fieldnotes.example/c/1' },
          { id: 'w3', senderId: 's1', subject: 'One more step', receivedAt: '2026-10-03T09:05:00Z', confirmUrl: 'https://theweekly.example/confirm/9' },
        ]}
      />
    </PageColumn>
  );
}

const savedStories: SavedViewProps = {
  stories: [
    {
      id: 'saved-1',
      issueId: 'issue-1',
      headline: issueBase.digest!.stories[0].headline,
      summary: issueBase.digest!.stories[0].summary,
      text: issueBase.digest!.stories[0].text ?? null,
      link: issueBase.digest!.stories[0].link ?? null,
      image: issueBase.digest!.stories[0].image ?? null,
      senderName: 'Infra Weekly',
      receivedAt: '2026-09-22T07:14:00Z',
      savedAt: '2026-09-23T08:02:00Z',
      discussedIndex: 0,
      arrived: '22 Sep, 7:14\u00a0AM',
      related: previewRelatedNotes.slice(0, 1),
    },
    {
      id: 'saved-2',
      issueId: null,
      headline: issueBase.digest!.stories[1].headline,
      summary: issueBase.digest!.stories[1].summary,
      text: null,
      link: issueBase.digest!.stories[1].link ?? null,
      image: null,
      senderName: 'Infra Weekly',
      receivedAt: '2026-09-15T07:10:00Z',
      savedAt: '2026-09-16T21:40:00Z',
      arrived: '15 Sep, 7:10\u00a0AM',
    },
    {
      id: 'saved-3',
      issueId: 'issue-2',
      headline: 'Keep a list of what you stopped, and why',
      summary: issueEssay.digest!.summary,
      text: null,
      link: null,
      image: null,
      senderName: 'Slow Letters',
      receivedAt: '2026-09-20T09:02:00Z',
      savedAt: '2026-09-20T12:30:00Z',
      arrived: '20 Sep, 9:02\u00a0AM',
    },
  ],
};

/** The job search's ten sections, as its layout lists them. */
const shellSections: NavSection[] = [
  { href: '/jobs', label: 'Now', icon: 'jobsHome', exact: true },
  { href: '/jobs/inbox', label: 'Inbox', icon: 'inbox', alsoMatches: ['/jobs/review'], badge: 3 },
  { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
  { href: '/jobs/activity', label: 'Activity', icon: 'activity' },
  { href: '/jobs/find', label: 'Find', icon: 'find' },
  { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
  { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
  { href: '/jobs/material', label: 'Material', icon: 'answers' },
  { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
];

/**
 * Places they have lived, for You's Places tab (plan #1991.5): the home they
 * live in now, a long name, a year-only stay, and one with nothing but a
 * name and a date.
 */
const youPlaces: Place[] = [
  {
    id: 'place-york',
    name: 'The terraced house on Bishopthorpe Road, by the river',
    city: 'York',
    region: 'North Yorkshire',
    country: 'United Kingdom',
    movedIn: '2019-08',
    movedOut: null,
    note: 'Two bedrooms and a yard. Walked to the station every morning for the Leeds job.\n\nThe landlord is Sam Okafor.',
    latitude: null,
    longitude: null,
  },
  {
    id: 'place-leeds',
    name: 'Flat above the bakery',
    city: 'Leeds',
    region: 'West Yorkshire',
    country: 'United Kingdom',
    movedIn: '2015',
    movedOut: '2019-08',
    note: null,
    latitude: null,
    longitude: null,
  },
  {
    id: 'place-lisbon',
    name: 'Lisbon',
    city: 'Lisbon',
    region: null,
    country: 'Portugal',
    movedIn: '2014-02',
    movedOut: '2014-09',
    note: null,
    latitude: null,
    longitude: null,
  },
  {
    id: 'place-childhood',
    name: 'Mum and Dad’s',
    city: null,
    region: null,
    country: null,
    movedIn: '1992',
    movedOut: '2014',
    note: null,
    latitude: null,
    longitude: null,
  },
];

/** The same places with positions for the Map view (plan #2091.4); the childhood home has none. */
const PLACE_POSITIONS: Record<string, [number, number]> = {
  'place-york': [53.96, -1.08],
  'place-leeds': [53.8, -1.55],
  'place-lisbon': [38.72, -9.14],
};
const youPlacesOnMap: Place[] = youPlaces.map((place) => {
  const at = PLACE_POSITIONS[place.id];
  return at ? { ...place, latitude: at[0], longitude: at[1] } : place;
});

/** Six details filled in, LinkedIn typed without its scheme (plan #2124.2). */
const youDetails: Details = {
  phone: '+1 (415) 555-0142',
  linkedin_url: 'linkedin.com/in/christopher-alexander-montgomery-whitfield',
  citizenship: 'United States and Ireland',
  race: 'White',
  gender: 'Man',
  sexuality: 'Straight',
};

/** The sections app/you/layout.tsx passes, copied for the same reason. */
const youSections: NavSection[] = [
  { href: '/you/personality', label: 'Personality', icon: 'personality' },
  { href: '/you/details', label: 'Details', icon: 'details' },
  { href: '/you/places', label: 'Places', icon: 'places' },
  { href: '/you/work', label: 'Work & school', icon: 'workSchool', exact: true },
  { href: '/you/insights', label: 'Insights', icon: 'insights', exact: true },
];

const triageCrumbs = [
  { label: 'Vault', href: '/vault' },
  { label: 'Quick note triage', href: '/vault/triage' },
];

/**
 * Three Learn now cards for the deck: a lesson from a track that cites no
 * section (plan #978), one idea card in the form the writer now produces, and
 * one written before cards carried one idea each.
 */
const deckCards: FeedCard[] = [
  {
    id: '00000000-0000-4000-8000-000000000003',
    reason: 'lesson',
    kind: 'lesson',
    title: 'Price ceilings cause shortages',
    source: 'Economics · Markets and prices',
    track: { id: '00000000-0000-4000-8000-0000000000aa', name: 'Economics' },
    article: '',
    section: null,
    why: 'Next in your Economics track. It builds on Supply and demand curves.',
    takeaway:
      'A legal maximum price set below what the market would clear at leaves more people wanting the good than there is of it.',
    context:
      'A price ceiling is a law saying a good may not be sold above a set price. The market-clearing price is the one at which the amount people want to buy equals the amount sellers offer.',
    hook: 'When New York froze many rents after 1943, the city’s vacancy rate for controlled flats stayed below 2% for decades.',
    summary:
      'At the capped price, buyers ask for more than at the market price and sellers offer less, because some of them can no longer cover their costs. The gap has to be closed some other way: queues, waiting lists, favouritism or a black market.',
    example:
      'In 1970s America, a cap on petrol prices during the oil shocks led to queues that ran around the block, and some states rationed fuel by the last digit of the number plate.',
    question:
      'A city caps taxi fares at half what riders pay today. What happens to the wait for a taxi at rush hour, and why?',
    answer:
      'It gets longer. Fewer drivers work at the lower fare while more riders want a cheap ride, so the shortage shows up as time spent waiting.',
    depth: null,
    difficulty: null,
    returning: null,
    shown: [],
    rest: [],
    restMinutes: 0,
    link: null,
    site: null,
    licence: null,
    relatedNotes: [
      {
        noteId: 'note-related-3',
        title: 'Rent control in my city',
        href: '/vault/n/Housing/Rent%20control%20in%20my%20city.md',
      },
    ],
    // A section of a lecture, so the bar under the player shows where it starts and ends (note 6c13bd61).
    // "In this video" under it says what the stretch argues and why it is here (note cde86a10).
    video: {
      videoId: 'ZK3O402wf1c',
      title: 'Price controls and the shortages they make',
      start: 724,
      end: 845,
      note: {
        said: 'A price ceiling below the market price leaves more people wanting the good than there is of it, and the gap is filled by queues and waiting lists.',
        why: 'It walks through the same supply and demand diagram behind price controls, with rent control as its main example.',
      },
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    reason: 'interest',
    kind: 'section',
    title: 'Planting on last year’s price',
    source: 'Cobweb model: Mechanism',
    track: null,
    article: 'Cobweb model',
    section: 'Mechanism',
    why: 'You write about economic system design (Economics).',
    takeaway:
      'When farmers plant based on last year’s price, prices can swing up and down for years instead of settling.',
    context:
      'Some goods, such as crops and livestock, must be planned a season or more before they are sold. The producer has to commit to an amount before seeing the price it will fetch.',
    hook: 'US hog prices swung in a four-year cycle for decades because farmers set next year’s herd from this year’s price.',
    summary:
      'A high price brings a glut the following season, the glut drives the price down, and the low price brings a shortage. Whether the swings die out depends on whether supply responds to price more or less steeply than demand does.',
    example:
      'Suppose demand is P = 100 − Q and farmers plant Q = P from last year’s price. Starting at P = 60, they plant 60, which sells at 40; next year they plant 40, which sells at 60. With equal slopes the cycle neither grows nor shrinks, and any steeper supply response makes it explode.',
    question:
      'A government starts publishing forecasts of next season’s price that farmers trust. What happens to the cycle, and why?',
    answer:
      'It damps or disappears. The cycle comes from planting on last year’s price; if farmers plant on an accurate forecast instead, output matches what the market will clear at, so the overshoot never starts.',
    depth: 'working',
    difficulty: null,
    returning: null,
    shown: [
      'The cobweb model or cobweb theory is an economic model that explains why prices might be subject to periodic fluctuations in certain types of markets.',
    ],
    rest: [
      'It describes cyclical supply and demand in a market where the amount produced must be chosen before prices are observed.',
    ],
    restMinutes: 1,
    link: 'https://en.wikipedia.org/wiki/Cobweb_model#Mechanism',
    site: 'Wikipedia',
    licence: 'CC BY-SA 4.0',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    reason: 'gap',
    kind: 'section',
    title: 'Tax incidence: Elasticity',
    source: null,
    track: null,
    article: 'Tax incidence',
    section: 'Elasticity',
    why: 'A field you write about but have never been tested in: Public economics.',
    takeaway: null,
    context: null,
    hook: 'Who legally pays a tax has no effect on who bears it; the less elastic side of the market ends up carrying most of it.',
    summary:
      'The burden of a tax splits between buyers and sellers in proportion to how little each can walk away.',
    example: 'Cigarette taxes fall mostly on smokers, because demand barely moves with price.',
    question: null,
    answer: null,
    depth: 'advanced',
    difficulty: null,
    returning: 'review',
    shown: [
      'Tax incidence is the analysis of the effect of a particular tax on the distribution of economic welfare.',
    ],
    rest: [],
    restMinutes: 0,
    link: 'https://en.wikipedia.org/wiki/Tax_incidence',
    site: 'Wikipedia',
    licence: 'CC BY-SA 4.0',
  },
];

/** The subject a subject's Now is drawn for (plan #1698), with the longest name. */
const nowSubjectLong = {
  id: '00000000-0000-4000-8000-0000000000ab',
  name: 'Comparative constitutional law and the separation of powers',
};

const measuredDraft: CostEstimate = {
  lowMicros: 300_000,
  medianMicros: 400_000,
  highMicros: 760_000,
  runs: 12,
  basis: 'measured',
  per: 'run',
  models: [SONNET],
};

const guessedSummary: CostEstimate = {
  lowMicros: 30_000,
  medianMicros: 50_000,
  highMicros: 90_000,
  runs: 2,
  basis: 'guess',
  per: 'run',
  models: [HAIKU],
};

const perReading: CostEstimate = {
  lowMicros: 12_000,
  medianMicros: 18_000,
  highMicros: 31_000,
  runs: 40,
  basis: 'measured',
  per: 'unit',
  models: [OPUS, 'jev-1.13.0'],
};

/**
 * The dev pages' status words with their tips showing (plan #1985.5): a step
 * stopped on you, a step waiting on another, an idea nobody has shaped, and
 * an inbox row at the right edge. Spaced so each open tip has room.
 */
function DevStatusTips() {
  const facts = {
    closed: false,
    openBeneath: [],
    resolution: null,
    blockAsk: null,
    comment: null,
    waitingOn: [{ number: 1412, outline: '1985.2', title: 'Fail the UI check on unlabelled icon buttons' }],
  };
  const blocked = planHealthWords('blocked', { ...facts, blockAsk: 'Which account should the runner post from?' });
  const waiting = planHealthWords('waiting', facts);
  return (
    <div className="space-y-28 pb-28">
      <div className="flex items-center gap-3">
        <span className="tabular text-small text-ink-ghost">#1985.4</span>
        <StateLabel glyph={blocked.glyph} word={blocked.word} tone={blocked.tone} title={blocked.title} defaultOpen />
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular text-small text-ink-ghost">#1985.5</span>
        <StateLabel glyph={waiting.glyph} word={waiting.word} tone={waiting.tone} title={waiting.title} defaultOpen />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-small text-ink-muted">An idea</span>
        <StateLabel
          glyph={IDEA_HEALTH_GLYPHS.open}
          word={IDEA_HEALTH_WORD.open}
          tone="quiet"
          title="Written down and not shaped yet. Shape it when you want it on the plan."
          defaultOpen
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="text-small text-ink-muted">On the inbox</span>
        <StateLabel
          glyph={PLAN_HEALTH_GLYPHS.proposed}
          word={WAITING_WORD.proposed}
          tone="caution"
          title={WAITING_TITLE.proposed}
          align="end"
          defaultOpen
        />
      </div>
    </div>
  );
}

function TooltipRows() {
  return (
    <div className="space-y-24 pb-24">
      <div className="flex items-center gap-2">
        <Tooltip label="Waiting on your reply" defaultOpen>
          <IconButton label="Waiting">
            <Clock strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <span className="text-small text-ink-muted">An icon button</span>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip
          label="Dash read this thread and found nothing that needs you, so it was filed without a notification"
          defaultOpen
        >
          <Chip tabIndex={0} aria-label="Filed quietly">
            Filed
          </Chip>
        </Tooltip>
        <span className="text-small text-ink-muted">A badge with a long tip</span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="text-small text-ink-muted">At a row’s right edge</span>
        <Tooltip label="Pinned to the top" align="end" defaultOpen>
          <IconButton label="Pinned">
            <Pin strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      {/* Its tip stands above it, so the row leaves the room above. */}
      <div className="flex items-center justify-end gap-2 pt-16">
        <span className="text-small text-ink-muted">In the bar at the foot of the window</span>
        <Tooltip label="CI on main passed 4 minutes ago" above defaultOpen>
          <IconButton label="CI on main">
            <span className="size-2 rounded-full bg-positive" aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

function CostHintRows() {
  return (
    <div className="space-y-24 pb-24">
      <div className="flex items-center gap-1">
        <Button>Draft cover letter</Button>
        <CostHint estimate={measuredDraft} what="Cost of drafting" defaultOpen />
      </div>
      <div className="flex items-center gap-1">
        <Button variant="secondary">Summarise thread</Button>
        <CostHint estimate={guessedSummary} what="Cost of summarising" defaultOpen />
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button variant="secondary">Grade 12 readings</Button>
        <CostHint estimate={perReading} count={12} what="Cost of grading" align="end" defaultOpen />
      </div>
    </div>
  );
}

/* The spend page's estimates against the ledger, from ranges shaped like the
 * live ledger's in September 2026: one measured row, uncertain rows with and
 * without runs, a per-item row, and two background ones. */
function SpendEstimates() {
  const ranges = new Map<OperationName, MeasuredRange>([
    ['classify-note', { runs: 7, lowMicros: 1_402, medianMicros: 1_538, highMicros: 1_710 }],
    [
      'write-opening-question',
      { runs: 1, lowMicros: 16_065, medianMicros: 16_065, highMicros: 16_065 },
    ],
    ['plan-topic', { runs: 2, lowMicros: 113_270, medianMicros: 400_732, highMicros: 688_194 }],
    ['map-sweep', { runs: 2_127, lowMicros: 1_533, medianMicros: 6_110, highMicros: 12_426 }],
    ['digest-issue', { runs: 91, lowMicros: 1_957, medianMicros: 4_370, highMicros: 16_446 }],
  ]);
  const pick = (names: OperationName[]) =>
    names.map((name) => compareEstimate(name, ranges.get(name)));
  return (
    <EstimatesTable
      foreground={pick([
        'plan-topic',
        'resolve-reference',
        'classify-note',
        'write-opening-question',
        'draft-answer',
      ])}
      background={pick(['map-sweep', 'digest-issue', 'classify-job-email'])}
      days={ESTIMATE_WINDOW_DAYS}
      minRuns={MEASURED_MIN_RUNS}
    />
  );
}

/** The jobs shell with This week in it, for surfaces drawn over a whole page. */
function PreviewShell({ children }: { children?: React.ReactNode }) {
  return (
    <AppShell
      account="preview"
      module="jobs"
      sections={shellSections}
      settingsHref="/jobs/settings"
      settingsLabel="Job search settings"
      displayName="Chris"
      email="chris@example.com"
      isOwner
      counts={{ jobs: '12', shopping: '3', todo: '8' }}
      theme={{ kind: 'written', id: 'paper' }}
      brief={null}
    >
      {children ?? <TodayLists board={todayBoard} timezone="Europe/London" />}
    </AppShell>
  );
}

/** Recommended roles on an ordinary day: two scored, one short of the preferences, one not yet read. */
const recommendedOpening = (over: Partial<OpenSuggestion>): OpenSuggestion => withSource({
  id: 'op-1',
  kind: 'apply',
  headline: 'Deployment Strategist',
  why: "Own onboarding, workflow design and renewals for private equity and banking deal teams using Mosaic's AI deal models. The $10B take-private work gives you standing with those users.",
  move: "1. Lead with the take-private and acquisition work at EY. 2. Say you want the strategy side of deployment. 3. Find someone on Mosaic's deployment team for a referral.",
  channel: null,
  message: null,
  url: 'https://jobs.ashbyhq.com/mosaic/1',
  location: 'New York City, on-site',
  companyName: 'Mosaic',
  companySlug: 'mosaic',
  personName: null,
  personTitle: null,
  sourceUrl: null,
  searchQuery: null,
  foundIn: "Search for roles like Concourse's, on request",
  contact: null,
  scores: {
    workplace: { value: 'on_site', confidence: 0.95 },
    seniority: { value: 'mid', confidence: 0.6 },
    salary: { value: false, confidence: 0.9 },
    fit: { value: 'partial', confidence: 0.6 },
    red_flags: { value: false, confidence: 0.7 },
    cover_letter: { value: false, confidence: 0.9 },
    duplicate: { value: false, confidence: 1 },
    closeness: { value: 2, confidence: 0.6 },
  },
  scoreNote: {
    fit: { value: 53, unsure: true, reason: "Probably a partial match, from Dash's short summary alone" },
    chance: { value: 30, band: 'medium', unsure: true, reason: '4 of 78 similar reached an interview, 5 still waiting' },
  },
  origin: 'goal',
  postingRead: false,
  compMaxCents: null,
  workMode: 'onsite',
  misses: [],
  createdAt: '2026-09-29T05:02:03Z',
  ...over,
});

/** The row's source, read from its origin, found_in and link as the loader reads them. */
function withSource(row: Omit<OpenSuggestion, 'source'> & { source?: OpenSuggestion['source'] }): OpenSuggestion {
  return { ...row, source: row.source ?? openingSource(row) };
}

const recommendedRoles: OpenSuggestion[] = [
  recommendedOpening({}),
  recommendedOpening({
    id: 'op-2',
    companyName: 'Moment',
    companySlug: null,
    location: 'New York, on-site',
    why: 'Act as the general manager of each customer, from first demo to expansion, with large investment and wealth firms. Strategic and ownership-heavy. Posted at $200K to $300K plus equity and bonus.',
    move: '1. Frame your MBA and startup advising as running an engagement end to end. 2. Show one thing you built. 3. Look for a Yale SOM alum at Moment or its investors.',
    scores: {
      workplace: { value: 'on_site', confidence: 0.95 },
      seniority: { value: 'senior', confidence: 0.6 },
      salary: { value: true, confidence: 0.95 },
      fit: { value: 'partial', confidence: 0.6 },
      red_flags: { value: false, confidence: 0.7 },
      cover_letter: { value: false, confidence: 0.9 },
      duplicate: { value: false, confidence: 1 },
    },
    scoreNote: {
      fit: { value: 56, unsure: true, reason: "Probably a partial match, from Dash's short summary alone" },
      chance: { value: 31, band: 'medium', unsure: true, reason: '4 of 78 similar reached an interview, 5 still waiting' },
    },
    misses: ['On-site, not how you want to work'],
  }),
  recommendedOpening({
    id: 'op-3',
    companyName: 'OpenAI',
    companySlug: 'openai',
    headline: 'Deployment Lead, Financial Services',
    location: 'New York City, hybrid',
    why: 'Work inside banks, asset managers and private capital firms to map workflows and lead AI rollouts. A stretch on seniority, but the same work as Concourse at a larger scale. Posted at $230K to $294K.',
    foundIn: "On OpenAI's own job board",
    origin: 'board',
    postingRead: true,
    scores: {
      workplace: { value: 'hybrid', confidence: 0.95 },
      seniority: { value: 'senior', confidence: 0.9 },
      salary: { value: true, confidence: 0.95 },
      fit: { value: 'partial', confidence: 0.7 },
      red_flags: { value: false, confidence: 0.7 },
      cover_letter: { value: false, confidence: 0.9 },
      duplicate: { value: false, confidence: 1 },
    },
    scoreNote: {
      fit: { value: 41, unsure: true, reason: 'Senior level, above most of your applications' },
      chance: { value: 20, band: 'low', unsure: false, reason: 'Above your usual level, 5 of 88 similar reached an interview' },
    },
  }),
  recommendedOpening({
    id: 'op-4',
    companyName: 'Clay',
    companySlug: 'clay',
    headline: 'Strategic Finance',
    location: 'New York',
    why: 'A strategic finance seat at a growing data company, close to the founders. Matches the FP&A-to-strategy move you wrote about.',
    foundIn: "On Clay's own job board",
    origin: 'board',
    scores: null,
    scoreNote: null,
  }),
  /* Two from startups weekly discovery found (plan #1685): companies not on
   * file, so no link to a company page, each saying where it was found. */
  recommendedOpening({
    id: 'op-5',
    companyName: 'Ledgerline',
    companySlug: null,
    headline: 'Strategic Finance Lead, Planning and Forecasting',
    location: 'Remote (US)',
    workMode: 'remote',
    url: 'https://jobs.ashbyhq.com/ledgerline/2',
    why: 'You want strategic finance close to the founders, and Ledgerline is building its first planning team after its seed round.',
    move: "1. Read the posting at the link. 2. Save it here if it fits, which adds Ledgerline to your companies. 3. Apply on their own site.",
    foundIn: 'Found on YC',
    origin: 'discovered',
    scores: null,
    scoreNote: null,
  }),
  recommendedOpening({
    id: 'op-6',
    companyName: 'Northwind Analytics',
    companySlug: null,
    headline: 'Senior FP&A Manager',
    location: 'New York or remote',
    workMode: null,
    url: 'https://northwind.example/careers',
    why: "Their post asks for an FP&A lead to build the board pack and pricing model, the two things your EY work covered.",
    move: "1. Read the posting at the link. 2. Save it here if it fits, which adds Northwind Analytics to your companies. 3. Apply on their own site.",
    foundIn: 'Found on Hacker News',
    origin: 'discovered',
    scores: null,
    scoreNote: null,
  }),
];

const recommendedStats: OriginStats[] = [
  { origin: 'search', found: 8, saved: 5, applied: 2, interviews: 0, dismissed: 3, expired: 0 },
  { origin: 'discovered', found: 10, saved: 2, applied: 1, interviews: 0, dismissed: 4, expired: 0 },
  { origin: 'goal', found: 41, saved: 4, applied: 1, interviews: 0, dismissed: 23, expired: 0 },
];

/** Two preferences the person took off /dev/ui (plan #1547). */
const REMOVED_TASTE = ['swipe-shows-next', 'categories-one-line'];

/**
 * Eight weeks of the correction measure on /dev/ui (plan #1543): a week with
 * no notes, a week where none counted, and a high week, so the empty column,
 * the zero and the tallest column are all drawn.
 */
const CORRECTION_WEEKS: CorrectionWeek[] = [
  { week: '2026-08-17', notes: 12, corrections: 5 },
  { week: '2026-08-24', notes: 4, corrections: 0 },
  { week: '2026-08-31', notes: 43, corrections: 19 },
  { week: '2026-09-07', notes: 29, corrections: 9 },
  { week: '2026-09-14', notes: 0, corrections: 0 },
  { week: '2026-09-21', notes: 26, corrections: 6 },
  { week: '2026-09-28', notes: 34, corrections: 4 },
  { week: '2026-10-05', notes: 7, corrections: 2 },
];

/**
 * Seven weeks of the sent-back count on /dev/ui (plan #2215.5): a week that
 * shipped nothing, one where none were sent back, and the audit week.
 */
const SENT_BACK_WEEKS: SentBackWeek[] = [
  { week: '2026-08-31', shipped: 31, sentBack: 4 },
  { week: '2026-09-07', shipped: 24, sentBack: 3 },
  { week: '2026-09-14', shipped: 0, sentBack: 0 },
  { week: '2026-09-21', shipped: 38, sentBack: 5 },
  { week: '2026-09-28', shipped: 42, sentBack: 3 },
  { week: '2026-10-05', shipped: 47, sentBack: 0 },
  { week: '2026-10-12', shipped: 19, sentBack: 2 },
];

/** People to meet: one with a drafted message and a long title, one with only a move. */
const recommendedPeople: OpenSuggestion[] = [
  recommendedOpening({
    id: 'pe-1',
    kind: 'reach_out',
    headline: 'Ask Priya Raghunathan for a referral to the deployment team at Mosaic',
    why: 'She moved from EY Transaction Services to Mosaic last year and now runs deployment for the private equity accounts, the team behind the role you saved.',
    move: 'Message her on LinkedIn, name the take-private work you did together on, and ask for twenty minutes.',
    channel: 'linkedin',
    message: 'Hi Priya, it has been a while since the take-private at EY. I saw the Deployment Strategist opening on your team and would value twenty minutes on what the work is really like.',
    url: null,
    location: null,
    personName: 'Priya Raghunathan',
    personTitle: 'Head of Deployment, Private Equity and Strategic Accounts',
    foundIn: null,
    scores: null,
    scoreNote: null,
    origin: 'search',
  }),
  recommendedOpening({
    id: 'pe-2',
    kind: 'reach_out',
    headline: 'Introduce yourself to the strategic finance lead at Clay',
    why: 'Clay is hiring into strategic finance and the lead posts about the FP&A-to-strategy move you wrote about.',
    move: 'Comment on the latest post first, then send a short note.',
    channel: null,
    message: null,
    url: null,
    location: null,
    companyName: 'Clay',
    companySlug: 'clay',
    personName: 'Sam Okafor',
    personTitle: 'Strategic Finance Lead',
    foundIn: 'From the step "Find people in strategic finance" on your career goal',
    scores: null,
    scoreNote: null,
    origin: 'goal',
  }),
];

/** Find for somebody a month in: three career goals entries, one track started and two suggested. */
const discoveredCompanies: DiscoveredCompany[] = [
  {
    id: 'wl-1',
    name: 'LiveFlow',
    website: 'https://liveflow.io',
    source: 'yc',
    description: 'AI-ERP and FP&A platform for finance teams.',
    reason: 'Your modeling and CPA background fit finance teams as users, with real AI product work.',
    score: 92,
    stage: 'Early',
    locations: ['New York, NY, USA'],
    postingRoles: [],
    board: { vendor: 'ashby' },
    noBoard: false,
    companySlug: null,
  },
  {
    id: 'wl-2',
    name: 'Column',
    website: 'https://column.com',
    source: 'hn',
    description: 'Column | Payment Ops, Deployment | San Francisco or Remote (US)',
    reason: 'Banking infrastructure hiring payment operations, which fits your finance and operations interest.',
    score: 81,
    stage: null,
    locations: ['San Francisco or Remote (US)'],
    postingRoles: ['Payment Operations', 'Deployment Lead'],
    board: { vendor: 'ashby' },
    noBoard: false,
    companySlug: 'column',
  },
  {
    id: 'wl-3',
    name: 'Arpari',
    website: 'https://arpari.com',
    source: 'yc',
    description: 'Multibank treasury management for corporate finance teams.',
    reason: 'Your cash forecasting project is directly related.',
    score: 68,
    stage: 'Early',
    locations: ['New York, NY, USA'],
    postingRoles: [],
    board: null,
    noBoard: true,
    companySlug: null,
  },
];

const findView = {
  aim: {
    targetTitles: 'Deployment Strategist, Strategic Finance, Forward Deployed Engineer, FP&A Manager',
    excludedIndustries: 'Crypto, Defense',
    gaps: [
      {
        key: 'home' as const,
        text: 'No home location is set, so roles and startups from anywhere are shown.',
        href: '/jobs/settings',
      },
    ],
  },
  roles: {
    suggestions: recommendedRoles,
    stats: recommendedStats,
    searchCostMicros: 4_200_000,
    searchLine: { running: false, tone: 'plain' as const, text: 'The search 2 hours ago found 3 new roles. Read 58 job boards, 12 postings worth a look.' },
    pathname: '/jobs/find',
  },
  companies: {
    companies: discoveredCompanies,
    status: {
      running: false,
      tone: 'plain' as const,
      text: 'The startup search 3 hours ago read 812 hiring startups that fit your preferences, kept 40 and found 12 more job boards.',
    },
  },
  people: recommendedPeople,
};

/** Jobs' Now drawn from the sample rows. */
function JobsTodaySurface({ board = todayBoard }: { board?: TodayBoard }) {
  return (
    <TodayPage
      board={board}
      summary={summariseSearch(
        todayPageRows,
        board.interviews.map((interview) => ({
          id: interview.id,
          scheduledAt: interview.scheduledAt,
          timeKnown: interview.timeKnown,
          groupId: interview.groupId,
        })),
        todayPageNow,
      )}
      since={todayPageSince}
      timezone="Europe/London"
    />
  );
}

/** The foot of a page with the status line under it, the run as given. */
function StatusRunSurface({ going }: { going: GoingRunLine }) {
  return (
    <div className="flex min-h-48 flex-col justify-between overflow-hidden rounded-card bg-sunken">
      <div className="p-4 text-small text-ink-muted">Today</div>
      <StatusLine
        lines={[{ text: 'mail: 14 new', at: null }]}
        brief={{ text: '3 roles waiting on you', tone: 'caution', href: '/jobs' }}
        main={null}
        going={going}
      />
    </div>
  );
}

/**
 * An application with four questions after Draft all answers (plan #2130.4):
 * three drafts waiting, one over its character limit, one answer already
 * approved, and three questions Dash asked back, one of them replied to.
 */
const draftedAnswers: PanelProps['answers'] = [
  { ...rolePanels.answers[0], wordLimit: 150 },
  {
    id: 'a2',
    answer: '',
    status: 'unanswered',
    questionId: 'q2',
    questionText: 'Tell us about a time you shipped something under a hard deadline. (400 characters)',
    questionKind: 'behavioural',
    canonicalAnswer: null,
    timesSeen: 1,
    evidenceItemIds: [],
    unsupportedClaims: [],
    wordLimit: null,
  },
  {
    id: 'a3',
    answer: '',
    status: 'unanswered',
    questionId: 'q3',
    questionText:
      'What would you want to change about how research tooling is built here in your first ninety days, and how would you know it had worked?',
    questionKind: 'motivation',
    canonicalAnswer: null,
    timesSeen: 1,
    evidenceItemIds: [],
    unsupportedClaims: [],
    wordLimit: 200,
  },
  {
    id: 'a4',
    answer: 'Yes. I hold settled status and need no sponsorship.',
    status: 'approved',
    questionId: 'q4',
    questionText: 'Are you authorised to work in the UK?',
    questionKind: 'logistics',
    canonicalAnswer: null,
    timesSeen: 5,
    evidenceItemIds: [],
    unsupportedClaims: [],
    wordLimit: null,
  },
];

const draftedAnswerDrafts: PanelProps['answerDrafts'] = {
  a1: {
    text: 'The research tooling team owns the pipeline every strategy desk reads from, and that is the work I have been doing at Kestrel: making market data people can trust. I would rather fix a bad day of ticks at the source than work around it downstream, and this team is where the source is.',
    evidenceItemIds: ['ev-1', 'ev-2'],
    unsupportedClaims: [],
    bannedFound: [],
  },
  a2: {
    text: 'In March the exchange moved its feed to a new binary format with three weeks of notice. I rewrote our decoder, ran it beside the old one on a week of recorded traffic until the two agreed to the tick, and cut over on the Sunday before the switch. The desks lost no trading time. What made it work was the side-by-side check: every difference was a bug in one or the other, and I fixed eleven of them before anyone downstream saw one.',
    evidenceItemIds: ['ev-3'],
    unsupportedClaims: [],
    bannedFound: [],
  },
  a3: {
    text: 'First I would sit with two desks and time how long an idea takes to become a backtest. I expect most of it is waiting on data to be cleaned by hand. I would move that cleaning into the pipeline, once, and measure the same journey again at the end of the quarter.',
    evidenceItemIds: [],
    unsupportedClaims: ['most of it is waiting on data'],
    bannedFound: [],
  },
};

/**
 * Dash's cover letter after Draft a cover letter (plan #2135.2): five
 * paragraphs citing three items, one claim to check, and two questions back,
 * the first already replied to.
 */
const draftedLetter: NonNullable<PanelProps['coverLetterDraft']> = {
  letter: [
    'Dear hiring team,',
    'I am applying for the quantitative developer role on your systematic trading teams. For the last three years at Kestrel I have built the research tooling our desk runs on: the backtester, the tick store behind it, and the checks that stop a bad day of market data reaching a live strategy.',
    'The part of your posting I keep coming back to is turning an idea into a backtest and a backtest into a live strategy. At Kestrel that path took two weeks when I joined. After I moved the backtester onto the same data path as production it took two days, and the strategies that went live behaved the way their backtests said they would.',
    'I write Python every day and C++ where the hot path needs it, and I have run market data at the scale of every US equity tick. I would like to bring that to the team that owns the pipeline every desk reads from.',
    'Thank you for reading. I would be glad to talk it through.',
  ].join('\n\n'),
  words: 178,
  evidenceItemIds: ['ev-1', 'ev-2', 'ev-3'],
  unsupportedClaims: ['the strategies that went live behaved the way their backtests said they would'],
  bannedFound: [],
  asks: [
    {
      id: 'letter-ask-1',
      answer_id: null,
      question: 'Who should the letter be addressed to? The posting names no hiring manager.',
      reply: 'Dana Okafor, who ran the phone screen',
    },
    {
      id: 'letter-ask-2',
      answer_id: null,
      question: 'Is the move from two weeks to two days something you can say publicly, or should it stay vaguer?',
      reply: null,
    },
  ],
};

const draftedAsks: PanelProps['dashAsks'] = [
  {
    id: 'ask-1',
    answer_id: 'a2',
    question: 'Which deadline should this be: the feed migration in March, or the regulatory report in 2024?',
    reply: null,
  },
  {
    id: 'ask-2',
    answer_id: 'a3',
    question: 'Have you used their open-source backtester, or only read about it?',
    reply: 'Ran the examples and read the docs, never in production.',
  },
  {
    id: 'ask-3',
    answer_id: null,
    question: 'Would you move to London for this, or is it remote only for you?',
    reply: null,
  },
];

export const SURFACES: readonly Surface[] = [
  {
    id: 'jobs-role-timeline',
    label: 'Role · Timeline and to-dos',
    module: 'jobs',
    width: 'wide',
    // A closed application, which opens on its timeline under the line saying
    // how far it got, with the role's one to-do list above the tabs.
    render: () => (
      <div className="space-y-6">
        <ClosedSummary
          text={closedSummary({
            status: 'rejected',
            reached: 'in_process',
            everSubmitted: true,
            closedOn: '8 Sep',
            interviewCount: 1,
            allQuestionsAdded: true,
          })}
        />
        <RoleTodos
          roleId="role-1"
          tasks={roleTasks}
          reminders={roleReminderFixtures}
          messages={rolePanels.messages}
          timezone="Europe/London"
        />
        <RoleDetailPanels
          {...rolePanels}
          status="rejected"
          defaultTab={defaultRoleTab('rejected')}
        />
      </div>
    ),
  },
  {
    id: 'jobs-role-posting',
    label: 'Role · Posting',
    module: 'jobs',
    width: 'wide',
    // A lead, which opens on its posting.
    render: () => (
      <RoleDetailPanels {...rolePanels} status="lead" defaultTab={defaultRoleTab('lead')} />
    ),
  },
  {
    id: 'jobs-role-answers',
    label: 'Role · Answers',
    module: 'jobs',
    width: 'wide',
    // An application being written, which opens on its questions.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-marked',
    label: 'Role · Answers, marked ready',
    module: 'jobs',
    width: 'wide',
    // Ready and All questions added ticked, the cover letter answered Yes (plan #2102.2, #2196.1),
    // with an answer and a letter written, so each shows Copy, and a comment under the
    // answer (notes 69abdbad, be3c6616).
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        readyToApply
        allQuestionsAdded
        hasCoverLetter
        answers={[
          {
            ...rolePanels.answers[0],
            answer:
              'The payments risk team sits where the product meets the money, and the last two years of my work have been there: models that flag a bad merchant before the first chargeback.',
            status: 'approved',
          },
        ]}
        coverLetter={'Dear hiring team,\n\nI have spent the last two years building risk models for a payments platform, and Lattice Pay is the team I would most like to do that with next.'}
        answerThreads={{
          [`job_search.application_answers:${rolePanels.answers[0].id}`]: [
            { id: 'c-1', author: 'me', body: 'Too long for their form, cut the second clause.', createdAt: '2026-10-14T09:00:00Z' },
          ],
        }}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-closed',
    label: 'Role · Answers, closed',
    module: 'jobs',
    width: 'wide',
    // A closed application shows the marks without controls.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="rejected"
        readyToApply
        allQuestionsAdded
        hasCoverLetter={false}
        defaultTab="answers"
      />
    ),
  },
  {
    id: 'jobs-role-answers-questions',
    label: 'Role · Answers drafted, with Dash\'s questions',
    module: 'jobs',
    width: 'wide',
    // After Draft all answers (plan #2130.4): a draft beside every unanswered
    // question, one over its character limit, and Dash's questions above the
    // cards with one already replied to.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        answers={draftedAnswers}
        answerDrafts={draftedAnswerDrafts}
        dashAsks={draftedAsks}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-drafting',
    label: 'Role · Answers, drafting all',
    module: 'jobs',
    width: 'wide',
    // Draft all answers mid-run: the button reads Drafting and the cards stay open.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        answers={draftedAnswers}
        draftRun={{ pending: true, error: null }}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-error',
    label: 'Role · Answers, drafting failed',
    module: 'jobs',
    width: 'wide',
    // Draft all answers failed: one line under the button says what went wrong.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        answers={draftedAnswers}
        draftRun={{ pending: false, error: 'Dash ran out of time before the answers were written. Nothing was saved; try again.' }}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-letter-draft',
    label: "Role · Cover letter drafted, with Dash's questions",
    module: 'jobs',
    width: 'wide',
    // After Draft a cover letter (plan #2135.2): the draft beside the empty
    // letter, one claim to check, and Dash's two questions with Redraft.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        coverLetterDraft={draftedLetter}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-letter-drafting',
    label: 'Role · Cover letter, drafting',
    module: 'jobs',
    width: 'wide',
    // Draft a cover letter mid-run: the button reads Drafting with a note under it.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        coverLetterRun={{ pending: true, error: null }}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answers-letter-error',
    label: 'Role · Cover letter, drafting failed',
    module: 'jobs',
    width: 'wide',
    // Draft a cover letter failed: one line under the button says what went wrong.
    render: () => (
      <RoleDetailPanels
        {...rolePanels}
        status="drafting"
        coverLetterRun={{
          pending: false,
          error: 'Dash ran out of time before the letter was written. Nothing was saved; try again.',
        }}
        defaultTab={defaultRoleTab('drafting')}
      />
    ),
  },
  {
    id: 'jobs-role-answer-draft',
    label: 'Role · An answer with its draft',
    module: 'jobs',
    width: 'wide',
    // The draft beside a question after Draft is pressed (note ad554975): one
    // drawn from the posting alone, citing nothing from the bank, counted
    // against the question's 150-word limit (plan #2130.4).
    render: () => (
      <AnswerCard
        answer={{ ...rolePanels.answers[0], wordLimit: 150 }}
        closed={false}
        initialDraft={{
          text: 'I want to work on the research tooling team because the posting describes the job I have been doing on the side for two years: making market data people can trust. The team owns the pipeline every strategy desk reads from, and I would rather fix a bad day of ticks at the source than work around it downstream.',
          evidenceItemIds: [],
          unsupportedClaims: ['for two years'],
          bannedFound: [],
        }}
      />
    ),
  },
  {
    id: 'jobs-role-interviews',
    label: 'Role · Interviews',
    module: 'jobs',
    width: 'wide',
    // The header and the facts too, in the role page's one column, so the
    // status, the excitement and the channel are drawn as the page sets them. A referral, so the
    // channel shows who referred you as well.
    render: () => (
      <div className="space-y-4">
          <PageHeader
            title="Senior Software Engineer, Platform"
            description="The Halloran-Achterberg group · New York · Hybrid"
            actions={
              <div className="flex items-center gap-2">
                <StatusPicker
                  applicationId="app-1"
                  status="in_process"
                  submittedAt="2026-07-31T12:00:00.000Z"
                />
                <ExcitementPicker applicationId="app-1" excitement={4} />
              </div>
            }
          />
          <DetailFacts>
            <Property label="Applied" value="31 Jul 2026" />
            <Property label="Confirmed" value="31 Jul 2026" />
            <Property label="First human reply" value="6 Aug 2026" />
            <Property
              label="Channel"
              value={
                <ChannelPicker
                  applicationId="app-1"
                  source="referral"
                  referralContactId="contact-2"
                  contacts={referrerFixtures}
                />
              }
            />
            <Property label="Comp band" value="$180k–$220k" />
            <Property label="Outcome" value="—" />
          </DetailFacts>
        <RoleDetailPanels {...rolePanels} defaultTab={defaultRoleTab('in_process')} />
      </div>
    ),
  },
  {
    /* The whole page on its board view (plan #1590): the live applications
     * only, with the one rail of filters both views share. */
    id: 'jobs-pipeline-board',
    label: 'Pipeline · Board',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelinePage rows={pipelineRows} params={{ view: 'board' }} />,
  },
  {
    /* The Pipeline narrowed to one source (plan #1658): the header carries
     * "Ask Dash about these", which opens the sheet with those roles. It is
     * drawn inside the shell, which holds the sheet it opens. */
    id: 'jobs-pipeline-filtered',
    label: 'Pipeline · Filtered, with the button for Dash',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <AskDashSurface page="/jobs/pipeline">
        <PreviewShell>
          <PipelinePage rows={pipelineRows} params={FILTERED_PIPELINE_PARAMS} />
        </PreviewShell>
      </AskDashSurface>
    ),
  },
  {
    /* The Pipeline narrowed to the roles with all their questions added (plan
     * #2196.2): the one chip set, the rest of the line unchanged. */
    id: 'jobs-pipeline-marks',
    label: 'Pipeline · All questions added filter',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <PreviewShell>
        <PipelinePage rows={pipelineRows} params={{ view: 'table', questions: 'yes' }} />
      </PreviewShell>
    ),
  },
  {
    /* The table view, every live application a row on one surface. */
    id: 'jobs-pipeline-table',
    label: 'Pipeline · Table',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelinePage rows={pipelineRows} params={{ view: 'table' }} />,
  },
  {
    /* The table with a column's menu open (note f05f5f04): its sort, then
     * the companies it can be narrowed to, one already chosen. */
    id: 'jobs-pipeline-column-menu',
    label: 'Pipeline · Table · Column filter',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <PipelinePage
        rows={pipelineRows}
        params={{ view: 'table', company: pipelineRows[0].companySlug }}
        openColumn="company"
      />
    ),
  },
  {
    /* The page as it opens: what is in process, waiting and to apply. */
    id: 'jobs-pipeline-focus',
    label: 'Pipeline · Focus',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelinePage rows={pipelineRows} params={{}} />,
  },
  {
    /* The three Jobs moments on the Pipeline board (plan #1596), each played
     * by the button above it through the board's own move. Only the sent
     * applications, so at phone width the stage a card leaves and the one it
     * lands in are both on the screen. */
    id: 'jobs-moment-forward',
    label: 'Pipeline · a role moving forward',
    module: 'jobs',
    width: 'wide',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="board-move"]',
      shows:
        'Tallow’s Backend Engineer card glides from Submitted down into In process while the cards and lanes around it glide to their new places, then “In process” is named across the foot of Tallow’s card.',
    },
    render: () => (
      <BoardMomentDemo
        rows={momentRows}
        applicationId="p3"
        to="in_process"
        label="Move Tallow to In process"
      />
    ),
  },
  {
    id: 'jobs-moment-offer',
    label: 'Pipeline · an offer',
    module: 'jobs',
    width: 'wide',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="board-move"]',
      shows:
        'Larkspur Vane’s card glides from In process down into Offer while the Halloran-Achterberg card slides up and the lanes resize with it, then “Offer · Larkspur Vane” is named across the card’s foot and one accent ring leaves the card and fades.',
    },
    render: () => (
      <BoardMomentDemo
        rows={momentRows}
        applicationId="p1"
        to="offer"
        label="Move Larkspur Vane to Offer"
      />
    ),
  },
  {
    id: 'jobs-moment-reject',
    label: 'Pipeline · a rejection',
    module: 'jobs',
    width: 'wide',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="board-move"]',
      shows:
        'Kestrel Bank’s card fades where it stands with nothing moving, Submitted then closes up over the space it left, and a toast reads “Declined: Kestrel Bank · 5 open” with Undo.',
    },
    render: () => (
      <BoardMomentDemo
        rows={momentRows}
        applicationId="p4"
        to="rejected"
        label="Decline Kestrel Bank"
      />
    ),
  },
  {
    /* The shopping item page's main panel, which arrived as a form until law
     * 14 reached it. Here so the read-first state can be looked at: it needs a
     * session and a row otherwise, which means nobody looks. */
    id: 'shopping-item-details',
    label: 'Inventory · Item details',
    module: 'shopping',
    width: 'wide',
    render: () => (
      <ItemDetailsPanel
        itemId="i1"
        item={{
          name: 'Brass Birmingham',
          variant: 'Deluxe edition',
          notes: 'Shelf C, second row. Insert is 3D printed; the box is a tight fit with it in.',
        }}
        categories={[
          { id: 'c1', name: 'Board games' },
          { id: 'c2', name: 'Books' },
        ]}
        categoryId="c1"
        categoryName="Board games"
        template={[
          { key: 'players', label: 'Players', type: 'text', inSearch: false },
          { key: 'bgg', label: 'BGG page', type: 'url', inSearch: false },
        ]}
        fields={[
          { key: 'players', label: 'Players', type: 'text', inSearch: false },
          { key: 'bgg', label: 'BGG page', type: 'url', inSearch: false },
          { key: 'weight', label: 'Weight', type: 'number', inSearch: false },
        ]}
        values={{
          players: '2–4',
          bgg: 'https://boardgamegeek.com/boardgame/224517',
          weight: '3.9',
        }}
        searchAvailable
      />
    ),
  },
  {
    /* The catalogue part of the same Details box, for a book with its
     * printing to confirm and a game from BoardGameGeek (plan #1950.3.4). */
    id: 'shopping-item-details-catalogue',
    label: 'Inventory · Item details, a book and a game',
    module: 'shopping',
    width: 'wide',
    render: () => <ShoppingItemCatalogueSurface />,
  },
  {
    /* The thread on a dev row, in the middle of an exchange. The waiting line
     * is up as well: it is only on screen while a tagged comment is being
     * answered, which is a few seconds nobody can hold still for a shot.
     *
     * In a card, because the thread's ground is a well inside one: every
     * caller draws it there, and the whole point of the ground is the step
     * down from the card behind it. Shot on the page ground alone it would be
     * a panel floating on a bench, which is not a thing the app has. */
    id: 'dev-comment-thread',
    label: 'Comments · a thread on a plan step',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread
          subject={threadRef('step', '00000000-0000-4000-8000-000000000412')}
          turns={commentThread}
          awaitingReply
        />
      </div>
    ),
  },
  {
    /* A comment Dash read and chose not to answer (plan #1650): the seen mark
     * under it where "replying…" would have been, and nothing from Dash after.
     * The same component serves goals, roles and every other row's thread. */
    id: 'dev-comment-thread-seen',
    label: 'Comments · a comment Dash marked seen',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread
          subject={threadRef('step', '00000000-0000-4000-8000-000000000415')}
          turns={[
            {
              id: 'seen-1',
              author: 'me',
              body: '@dash thanks, that settles it. I will hand #412 back myself.',
              createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000 - 5 * 60 * 1000).toISOString(),
              acknowledgedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 - 5 * 60 * 1000 + 40_000).toISOString(),
            },
          ]}
        />
      </div>
    ),
  },
  {
    /* What a comment asked Dash to run that costs money (plan #2228.2): the
     * approval card under the reply that says it was queued, in the thread
     * on a goal, as every row's thread draws it. */
    id: 'thread-paid',
    label: 'Thread · Paid actions waiting under a comment',
    module: 'goals',
    width: 'narrow',
    render: () => {
      const at = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
      const press = (id: string, line: string, medianMicros: number): DashChange => ({
        id,
        conversationId: '00000000-0000-4000-8000-000000000441',
        turnId: 'paid-ask',
        kind: 'paid_action',
        status: 'proposed',
        subjectRef: null,
        writtenTable: null,
        writtenRef: null,
        undo: null,
        createdAt: at(4),
        doneAt: null,
        declinedAt: null,
        undoneAt: null,
        input: {
          tool: 'write_year_review',
          action: 'app/timeline/actions.ts#writeYearReview',
          args: {},
          line,
          estimate: {
            lowMicros: Math.round(medianMicros * 0.7),
            medianMicros,
            highMicros: Math.round(medianMicros * 1.6),
            runs: 9,
            basis: 'measured',
            per: 'run',
            models: [SONNET],
          },
          workspace: null,
          paths: ['/jobs/pipeline'],
        },
      });
      return (
        <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
          <p className="text-body text-ink">Move into a senior analyst role by spring</p>
          <Thread
            subject={threadRef('goal', '00000000-0000-4000-8000-000000000442')}
            turns={[
              {
                id: 'paid-ask',
                author: 'me',
                body: '@dash draft my answers on the Northwind and Fernhill applications',
                createdAt: at(5),
                paid: [
                  press('thread-paid-1', 'Draft the answers on the Northwind Analytics application.', 148_000),
                  press('thread-paid-2', 'Draft the answers on the Fernhill Labs application.', 131_000),
                ],
              },
              {
                id: 'paid-reply',
                author: 'claude',
                body: 'I have queued both drafts. They cost money, so nothing runs until you accept them below.',
                createdAt: at(4),
              },
            ]}
          />
        </div>
      );
    },
  },
  {
    /* "Dash at work" on the button that started a run (plan #1964.2.1): the
     * press hands the area to Dash and the button's working mark stands in
     * place of its label while the run goes. */
    id: 'dash-action-run',
    label: 'Dash action · a run going',
    module: 'goals',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="dash-run"]',
      shows:
        'Pressing “Plan this area” turns its mark to working beside the label, then the label gives way to the working mark alone, pulsing in the middle of a button that keeps its width, as the line beside it says Dash is planning the area.',
    },
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">Health</p>
        <DashRunButtonDemo
          label="Plan this area"
          line="Dash is planning this area · Reading your notes"
        />
      </div>
    ),
  },
  {
    /* The "Dash at work" moment ending on the seen mark (plan #1652): Dash's
     * mark works where its reply would go, then Dash only acknowledges and the
     * mark rests under the comment as the seen mark arrives. */
    id: 'dev-comment-thread-seen-moment',
    label: 'Comments · Dash at work, then seen',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="dash-seen"]',
      shows:
        'Dash’s mark leans and races beside “Reading the row and replying…” under the comment, then that line goes, the mark rests level under the comment and a check grows in beside “Seen by Dash”.',
    },
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <DashSeenDemo
          subject={threadRef('step', '00000000-0000-4000-8000-000000000416')}
          comment={{
            id: 'seen-moment-1',
            author: 'me',
            body: '@dash thanks, that settles it. I will hand #412 back myself.',
            // Old enough that the thread is not already waiting on Dash: the
            // press is what starts the wait.
            createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          }}
          seenAt={new Date(Date.now() - 3 * 60 * 60 * 1000 + 40_000).toISOString()}
        />
      </div>
    ),
  },
  {
    /* The same component on a row nobody has written on, which is the state
     * that draws no panel at all: a ground round a single Add a comment button
     * is a section announcing it has nothing in it -- law 1. Worth its own
     * surface because it is what the thread looks like on most rows. */
    id: 'dev-comment-thread-empty',
    label: 'Comments · a row with nothing on it',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread subject={threadRef('step', '00000000-0000-4000-8000-000000000413')} turns={[]} />
      </div>
    ),
  },
  {
    /* The box, open, which is the only state the send control can be looked at
     * in: it is a trigger until it is pressed, so nothing in the app renders
     * it standing open and `composerOpen` is the only way a shot reaches it.
     * Empty, so the send control is in its disabled state and the line under
     * the words says a note reaches nobody until it is tagged. */
    id: 'dev-comment-thread-composer',
    label: 'Comments · the box you send from',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread
          subject={threadRef('step', '00000000-0000-4000-8000-000000000414')}
          turns={commentThread}
          composerOpen
        />
      </div>
    ),
  },
  {
    /* The dev plan as a list, every feature unfolded (plan #993). What a
     * change to the plan's rows is checked against: shot before and after,
     * the two should not differ. */
    id: 'dev-plan-tree',
    label: 'Plan · the tree, unfolded',
    module: 'dev',
    width: 'page',
    render: () => <PlanTreeSurface />,
  },
  {
    /* The Assignee column's tooltip held open (plan #2069.1): who a row is
     * on, and on a split feature how many steps each holds. */
    id: 'dev-plan-tree-assignee-tip',
    label: 'Plan · who a row is on, tooltip open',
    module: 'dev',
    width: 'page',
    render: () => <PlanAssigneeTipSurface />,
  },
  {
    /* The plan's Table view (plan #1669): one row per open feature, grouped
     * by module, each opening the feature's page. */
    id: 'dev-plan-table',
    label: 'Plan · features as a table',
    module: 'dev',
    width: 'page',
    render: () => <PlanTableSurface />,
  },
  {
    /* The same plan with its rows opened, for the panel behind a row: the
     * detail, the questions, what it waits on and the thread. */
    id: 'dev-plan-opened',
    label: 'Plan · rows opened',
    module: 'dev',
    width: 'page',
    render: () => <PlanOpenedSurface />,
  },
  {
    /* The burn-up chart on a goal's or feature's Overview (plan #1837): a
     * month with scope added twice, a three-day run, and two days, which
     * draw nothing. */
    id: 'scope-burn-up',
    label: 'Steps over time · burn-up chart',
    module: 'goals',
    width: 'page',
    render: () => <BurnUpSurface />,
  },
  {
    /* A goal's metrics on its Overview (plan #2084.2): twelve weeks with a
     * target, five months with none and a target above every count. Its
     * hidden parts follow: a bar's tooltip, a metric with nothing counted
     * yet, and the section's message when the read fails. */
    id: 'goals-metrics',
    label: 'Goals · Metrics as bar charts',
    module: 'goals',
    width: 'page',
    render: () => <GoalMetricsSurface />,
  },
  {
    id: 'goals-metrics-tooltip',
    label: 'Goals · Metrics, a bar hovered',
    module: 'goals',
    width: 'page',
    render: () => <GoalMetricsTooltipSurface />,
  },
  {
    id: 'goals-metrics-empty',
    label: 'Goals · Metrics, nothing counted yet',
    module: 'goals',
    width: 'page',
    render: () => <GoalMetricsEmptySurface />,
  },
  {
    id: 'goals-metrics-error',
    label: 'Goals · Metrics, the read failed',
    module: 'goals',
    width: 'page',
    render: () => <GoalMetricsErrorSurface />,
  },
  {
    /* A feature's own page (plan #1664): breadcrumbs, the Overview tab with
     * Dash's latest update (plan #1666), the detail, a question, what it
     * waits on and the thread, and the properties column. */
    id: 'dev-plan-feature',
    label: 'Plan · a feature’s page',
    module: 'dev',
    width: 'page',
    render: () => <PlanFeatureSurface />,
  },
  {
    /* The same page with Edit pressed (plan #1670): the feature's compose
     * surface, filled in, in place of the Overview. */
    id: 'dev-plan-feature-edit',
    label: 'Plan · editing a feature',
    module: 'dev',
    width: 'page',
    render: () => <PlanFeatureEditSurface />,
  },
  {
    /* The same page on its Activity tab (plan #1667): the feature's history
     * by day, newest first, each entry linking to its row. */
    id: 'dev-plan-feature-activity',
    label: 'Plan · a feature’s activity',
    module: 'dev',
    width: 'page',
    render: () => <PlanFeatureActivitySurface />,
  },
  {
    /* The same page on its Steps tab: the steps and substeps grouped by
     * status (plan #1665), done and dropped folded, the tree one chip away. */
    id: 'dev-plan-feature-steps',
    label: 'Plan · a feature’s steps',
    module: 'dev',
    width: 'page',
    render: () => <PlanFeatureStepsSurface />,
  },
  {
    /* The Steps tab after pressing "Yours" in the properties (plan #1668):
     * only the open steps you hold, questions and setup jobs included. */
    id: 'dev-plan-feature-steps-yours',
    label: 'Plan · a feature’s steps, yours only',
    module: 'dev',
    width: 'page',
    render: () => <PlanFeatureStepsYoursSurface />,
  },
  {
    /* A step the design critic stopped after round 3 (plan #1610): the last
     * fixes and shots for each surface, one with its shots uploaded and one
     * without, and accept or say what to change. */
    id: 'dev-plan-critic-stop',
    label: 'Plan · a screen the critic stopped',
    module: 'dev',
    width: 'page',
    render: () => <PlanCriticStopSurface />,
  },
  {
    /* A finished step opened on the screens it changed (plan #1541): before
     * and after on a phone, side by side, for a surface with both, a new
     * surface with no before, and one whose pictures were not uploaded. */
    id: 'dev-plan-screen-change',
    label: 'Plan · a step’s screens before and after',
    module: 'dev',
    width: 'page',
    render: () => <PlanScreenChangeSurface />,
  },
  {
    /* The thumbs-down under a finished step's pictures (plan #1542): opened
     * under the first surface, with the box that says what is wrong, and
     * closed under the second. */
    id: 'dev-plan-send-back',
    label: 'Plan · sending a screen back',
    module: 'dev',
    width: 'page',
    render: () => <PlanSendBackSurface />,
  },
  {
    /* A finished step's screens with the mockup you approved beside the
     * build (plan #2215.10): the mockup first, Send back under each pair,
     * and a surface with no mockup drawn as before. */
    id: 'dev-plan-screen-mockup',
    label: 'Plan · a step’s screens beside their mockup',
    module: 'dev',
    width: 'page',
    render: () => <PlanScreenMockupSurface />,
  },
  {
    /* A goal's steps, drawn with the plan's shared row (plan #982), beside
     * the plan's own shots so the two can be compared. */
    id: 'goals-steps-tree',
    label: 'Goal · the steps',
    module: 'goals',
    width: 'page',
    render: () => <GoalTreeSurface />,
  },
  {
    /* The Assignee tooltip held open on a stage split between you and Dash
     * (plan #2069.2). */
    id: 'goals-steps-tree-assignee-tip',
    label: 'Goal · who a step is on, tooltip open',
    module: 'goals',
    width: 'page',
    render: () => <GoalAssigneeTipSurface />,
  },
  {
    /* A goal with no steps yet: the empty state and Add a step. */
    id: 'goals-steps-tree-empty',
    label: 'Goal · no steps yet',
    module: 'goals',
    width: 'page',
    render: () => <GoalEmptySurface />,
  },
  {
    /* The same goal with every step opened: detail, Needs, questions, what
     * it waits on, the goal's own slots and the thread. */
    id: 'goals-steps-opened',
    label: 'Goal · steps opened',
    module: 'goals',
    width: 'page',
    render: () => <GoalOpenedSurface />,
  },
  {
    /* A step on its own page (plan #1620): the row from the goal page,
     * opened, with its sub-steps beneath. */
    id: 'goals-step',
    label: 'Goal · a step on its own page',
    module: 'goals',
    width: 'page',
    render: () => <GoalStepSurface />,
  },
  {
    /* A sub-step on its own page, naming the step it sits under. */
    id: 'goals-substep',
    label: 'Goal · a sub-step on its own page',
    module: 'goals',
    width: 'page',
    render: () => <GoalSubStepSurface />,
  },
  {
    /* Closing a step on its own page (plan #1623): the goal's close ring
     * grows out of the step's glyph. Played by the button above it. */
    id: 'goals-step-close',
    label: 'Goal · closing a step on its page',
    module: 'goals',
    width: 'page',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="step-close"]',
      shows:
        'Call the card company turns done, and one accent hexagon ring grows out of its glyph and fades, settled by about two thirds of a second.',
    },
    render: () => <StepCloseDemo />,
  },
  {
    /* A step Dash finished, opened on its own page (plan #1623): the row
     * settles in and Dash's mark beside the title flashes once. */
    id: 'goals-step-arrival',
    label: 'Goal · a step Dash finished, on its page',
    module: 'goals',
    width: 'page',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="step-arrival"]',
      shows:
        'Draft what to say on the call opens again as just finished by Dash: its heading row rises into place and Dash’s mark beside the title swells once, all settled within the second.',
    },
    render: () => <StepArrivalDemo />,
  },
  {
    /* The Goals home on an ordinary week (plans #1043, #1077): Dash's card
     * with a two-paragraph note, five things in Do next (one with Dash's
     * draft beside it) linking to the Inbox, Dash's line, a result Dash
     * wrote, and an errand due later under Other goals. */
    id: 'goals-home',
    label: 'Goals · home',
    module: 'goals',
    width: 'page',
    render: () => <GoalsHomeSurface />,
  },
  {
    /* Everything on you in Goals, grouped as the Inbox in Dev is. */
    id: 'goals-inbox',
    label: 'Goals · Inbox',
    module: 'goals',
    width: 'page',
    render: () => <GoalsInboxSurface />,
  },
  {
    /* The one Inbox component (plan #1937.4) from its row shape alone, as
     * every workspace's Inbox draws it: the three sections, the verbs, Later
     * and Decline, and the Later fold open. */
    id: 'inbox-page',
    label: 'Inbox · the one component',
    module: 'dev',
    width: 'page',
    render: () => <InboxPageSurface />,
  },
  /* Each workspace's Inbox (plan #1937.5): the agenda's on-you rows cut to
   * the workspace, with a queue row where it keeps one. News is drawn empty.
   * Fixtures in workspace-inbox-surfaces.tsx. */
  {
    id: 'shopping-inbox',
    label: 'Shopping · Inbox',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingInboxSurface />,
  },
  {
    id: 'jobs-inbox',
    label: 'Job search · Inbox',
    module: 'jobs',
    width: 'page',
    render: () => <JobsInboxSurface />,
  },
  {
    id: 'todo-inbox',
    label: 'Todo · Inbox',
    module: 'todo',
    width: 'page',
    render: () => <TodoInboxSurface />,
  },
  {
    id: 'vault-inbox',
    label: 'Vault · Inbox',
    module: 'vault',
    width: 'page',
    render: () => <VaultInboxSurface />,
  },
  {
    id: 'learn-inbox',
    label: 'Learn · Inbox',
    module: 'learn',
    width: 'page',
    render: () => <LearnInboxSurface />,
  },
  {
    id: 'news-inbox',
    label: 'News · Inbox, empty',
    module: 'news',
    width: 'page',
    render: () => <NewsInboxSurface />,
  },
  {
    /* Three areas and their goals, edited where they stand. */
    id: 'goals-all',
    label: 'Goals · all goals',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllSurface />,
  },
  {
    /* A goal's row menu on All goals, open: Later and Drop (plans #2097.1, #1957.8). */
    id: 'goals-all-menu',
    label: 'Goals · all goals, a goal’s menu',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllPutAwayMenuSurface />,
  },
  {
    /* Back on All goals after parking a goal: the toast with Undo (plan #2097.1). */
    id: 'goals-all-toast',
    label: 'Goals · all goals, parked with Undo',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllPutAwayToastSurface />,
  },
  {
    /* Select on, three goals ticked: the bar with Later and Drop (plans #2097.2, #1957.8). */
    id: 'goals-all-select',
    label: 'Goals · all goals, several selected',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllSelectSurface />,
  },
  {
    /* Drop pressed with six ticked: the bar asks first (plan #2097.2). */
    id: 'goals-all-select-confirm',
    label: 'Goals · all goals, dropping six',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllSelectConfirmSurface />,
  },
  {
    /* Three goals parked together: one toast and one Undo (plan #2097.2). */
    id: 'goals-all-select-toast',
    label: 'Goals · all goals, parked three with Undo',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllSelectToastSurface />,
  },
  {
    /* The goal page's heading menu, open, with Later and Drop (plans #2097.1, #1957.8). */
    id: 'goals-page-top-menu',
    label: 'Goal · the heading menu',
    module: 'goals',
    width: 'page',
    render: () => <GoalPutAwayMenuSurface />,
  },
  {
    /* Drop pressed: the confirm naming its steps (plan #2097.1). */
    id: 'goals-page-top-archive',
    label: 'Goal · dropping it',
    module: 'goals',
    width: 'page',
    render: () => <GoalArchiveConfirmSurface />,
  },
  {
    /* An area's own page (plan #1619): one area, its goals and proposals. */
    id: 'goals-area',
    label: 'Goals · an area',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAreaSurface />,
  },
  {
    /* A goal's page on its Overview tab (plan #1671), in the tabbed detail
     * pattern: the path, title and done-when, the properties column, then
     * Dash's status card, the number and its readings, Waiting on you, one
     * Learn goal linked and a file. */
    id: 'goals-page-top',
    label: 'Goal · the Overview tab',
    module: 'goals',
    width: 'page',
    render: () => <GoalTopSurface />,
  },
  {
    /* The same frame on its Steps tab: the step tree and its stages. */
    id: 'goals-page-steps',
    label: 'Goal · the Steps tab',
    module: 'goals',
    width: 'page',
    render: () => <GoalStepsTabSurface />,
  },
  {
    /* A goal closing with the Steps tab open (plan #1672): the hexagon in the
     * title completes with its ring, then the steps fold into one line. */
    id: 'goals-page-close',
    label: 'Goal · closing it on the Steps tab',
    module: 'goals',
    width: 'page',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="goal-page-close"]',
      shows:
        'Close the goal: one accent hexagon ring grows out of the hexagon beside the title and fades, then the steps fold into one Steps line, all settled by about two thirds of a second.',
    },
    render: () => <GoalPageCloseDemo />,
  },
  {
    /* A step Dash finished, on the Steps tab (plan #1672). */
    id: 'goals-page-arrival',
    label: 'Goal · a step Dash finished, on the Steps tab',
    module: 'goals',
    width: 'page',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="goal-page-arrival"]',
      shows:
        'Draft what to say on the call settles into place in the step list and Dash’s mark beside it swells and takes the accent once, settled within the second.',
    },
    render: () => <GoalPageArrivalDemo />,
  },
  {
    /* The same frame on its Activity tab: the steps closed, the runs and
     * the goal's comments. */
    id: 'goals-page-activity',
    label: 'Goal · the Activity tab',
    module: 'goals',
    width: 'page',
    render: () => <GoalActivitySurface />,
  },
  {
    /* A file Claude wrote (core.files): the summary, then a table, a list
     * and a caveats section in the body. */
    id: 'goals-file',
    label: 'Goals · a file',
    module: 'goals',
    width: 'page',
    render: () => <FileSurface />,
  },
  {
    /* A goal just added: the Claude line and the row of add lines. */
    id: 'goals-page-bare',
    label: 'Goal · a bare goal',
    module: 'goals',
    width: 'page',
    render: () => <GoalBareSurface />,
  },
  {
    /* The bare goal's link line pressed: the picker for a first link. */
    id: 'goals-page-linking',
    label: 'Goal · linking the first Learn goal',
    module: 'goals',
    width: 'page',
    render: () => <GoalLinkingSurface />,
  },
  {
    /* An information step holding one record: two asked values, the rest
     * folded under Other fields. */
    id: 'goals-info-one',
    label: 'Goal · a one-record information step',
    module: 'goals',
    width: 'page',
    render: () => <InformationOneSurface />,
  },
  {
    /* A list step: three loans of nineteen fields, four of them asked. */
    id: 'goals-info-list',
    label: 'Goal · a list information step',
    module: 'goals',
    width: 'page',
    render: () => <InformationListSurface />,
  },
  {
    /* The same list with one row's other fields showing and a balance
     * being changed in its cell. */
    id: 'goals-info-list-open',
    label: 'Goal · a list step, other fields and an editor open',
    module: 'goals',
    width: 'page',
    render: () => (
      <InformationListSurface
        seam={{ openRow: 'loan-student', editing: { recordId: 'loan-car', key: 'balance' } }}
      />
    ),
  },
  {
    /* The design language, held to itself. It is the one surface where being
     * wrong is self-refuting, and it is the surface most likely to drift,
     * because it is written in prose and prose does not fail a type check. */
    id: 'dev-ui',
    label: 'UI · the design language',
    module: 'dev',
    width: 'wide',
    render: () => <UiStandard corrections={CORRECTION_WEEKS} sentBack={SENT_BACK_WEEKS} removedTaste={REMOVED_TASTE} />,
  },
  {
    /* The correction measure on /dev/ui alone (plan #1543), since the whole
     * page photographs at sixty thousand pixels tall and a chart is lost in
     * it. The empty and unread states are one sentence each, drawn beneath. */
    id: 'dev-ui-corrections',
    label: 'UI · how often you correct a new screen',
    module: 'dev',
    width: 'page',
    render: () => (
      <div className="space-y-6">
        <CorrectionsChart weeks={CORRECTION_WEEKS} />
        <CorrectionsChart weeks={CORRECTION_WEEKS.slice(-2)} />
        <CorrectionsChart weeks={[]} />
      </div>
    ),
  },
  {
    /* The sent-back count on /dev/ui alone (plan #2215.5), with the empty and
     * unread states beneath, since the whole page is too tall to read a chart. */
    id: 'dev-ui-sent-back',
    label: 'UI · how many new screens you send back',
    module: 'dev',
    width: 'page',
    render: () => (
      <div className="space-y-6">
        <SentBackChart weeks={SENT_BACK_WEEKS} />
        <SentBackChart weeks={SENT_BACK_WEEKS.slice(-2)} />
        <SentBackChart weeks={[]} />
        <SentBackChart weeks={null} />
      </div>
    ),
  },
  {
    /* The preferences on /dev/ui alone (plan #1547), with their Remove and
     * the fold of removed ones, since the whole page is too tall to read a
     * row of it. The fold of removed ones is drawn open. Beneath, the state
     * with every preference removed. */
    id: 'dev-ui-taste',
    label: 'UI · your preferences',
    module: 'dev',
    width: 'page',
    render: () => (
      <div className="space-y-6">
        <TasteList removed={REMOVED_TASTE} openRemoved />
        <TasteList removed={TASTE.map((taste) => taste.id)} />
      </div>
    ),
  },
  {
    /* The review tool, reviewed by itself. Circular on purpose: the frames it
     * draws are the same frames it is drawn in, so if the scaling is wrong it
     * is wrong here too. */
    id: 'dev-surfaces',
    label: 'Surfaces · the review tool',
    module: 'dev',
    width: 'wide',
    render: () => (
      <SurfaceReview
        surfaces={[
          {
            id: 'jobs-pipeline-dense',
            label: 'Pipeline · Dense list (experiment)',
            module: 'jobs',
            changed: { step: 1541, checkedAt: '2026-10-05T10:40:00Z' },
            notes: [
              {
                id: 'n1',
                body: 'Rows are right but the stars are noisy at this size.',
                status: 'open',
                resolutionNote: null,
              },
            ],
          },
          {
            id: 'jobs-role-timeline',
            label: 'Role · Timeline and to-dos',
            module: 'jobs',
            notes: [],
          },
        ]}
      />
    ),
  },
  {
    /* The same tool filtered to "Changed this week" (plan #1542): only the
     * surface a step changed in the last seven days, with the step named. */
    id: 'dev-surfaces-changed',
    label: 'Surfaces · changed this week',
    module: 'dev',
    width: 'wide',
    render: () => (
      <SurfaceReview
        show="changed"
        surfaces={[
          {
            id: 'jobs-pipeline-dense',
            label: 'Pipeline · Dense list (experiment)',
            module: 'jobs',
            changed: { step: 1541, checkedAt: '2026-10-05T10:40:00Z' },
            notes: [],
          },
          {
            id: 'jobs-role-timeline',
            label: 'Role · Timeline and to-dos',
            module: 'jobs',
            notes: [],
          },
        ]}
      />
    ),
  },
  {
    /* The experiment. Same rows, same width, beside the thing it questions. */
    id: 'jobs-pipeline-dense',
    label: 'Pipeline · Dense list (experiment)',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelineDenseList rows={pipelineRows} />,
  },
  {
    id: 'jobs-company',
    label: 'Company · Research, contacts and sends',
    module: 'jobs',
    width: 'wide',
    // With the search's estimate, as the jobs layout provides it (law 16).
    render: () => (
      <PaidCostsProvider
        costs={{ 'app/jobs/(app)/companies/actions.ts#proposeAiCompanyEnrichment': guessedSummary }}
      >
        <CompanyPanels {...companyPanels} />
      </PaidCostsProvider>
    ),
  },
  {
    /* The About tab: details, then what you know about the place (plan #1628). */
    id: 'jobs-company-about',
    label: 'Company · About the place',
    module: 'jobs',
    width: 'wide',
    render: () => <CompanyPanels {...companyPanels} opensOn="about" />,
  },
  {
    /* People with its add form open (note 4323ee10). */
    id: 'jobs-company-add-person',
    label: 'Company · Adding a person',
    module: 'jobs',
    width: 'wide',
    // With the search's estimate, as the jobs layout provides it, so the $
    // beside "Fill blanks from the web" is drawn (law 16).
    render: () => (
      <PaidCostsProvider
        costs={{ 'app/jobs/(app)/companies/actions.ts#proposeAiCompanyEnrichment': guessedSummary }}
      >
        <CompanyPanels {...companyPanels} opensOn="people" addingPerson />
      </PaidCostsProvider>
    ),
  },
  {
    id: 'jobs-review',
    label: 'Review queue',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <ReviewQueue
        rows={reviewRows}
        counts={{
          all: reviewRows.length,
          messages: reviewRows.filter((row) => row.kind === 'message').length,
          applications: reviewRows.filter((row) => row.kind === 'application').length,
          events: reviewRows.filter((row) => row.kind === 'event').length,
        }}
        view="all"
        timezone="Europe/London"
        companyNames={knownCompanies.map((company) => company.name)}
        allRoles={allRoles}
      />
    ),
  },
  {
    id: 'jobs-settings',
    label: 'Jobs · Settings, the Search tab',
    module: 'jobs',
    width: 'page',
    render: () => <JobsSettingsView {...settings} />,
  },
  {
    id: 'jobs-material',
    label: 'Material · Answers',
    module: 'jobs',
    width: 'wide',
    render: () => <MaterialView {...material} />,
  },
  {
    id: 'jobs-material-evidence',
    label: 'Material · Evidence',
    module: 'jobs',
    width: 'wide',
    // With the proposal's estimate, as the jobs layout provides it, so the $
    // beside Propose is drawn (law 16).
    render: () => (
      <PaidCostsProvider
        costs={{ 'app/jobs/(app)/material/evidence-actions.ts#proposeEvidence': guessedSummary }}
      >
        <MaterialView {...material} part="evidence" />
      </PaidCostsProvider>
    ),
  },
  {
    id: 'jobs-material-voice',
    label: 'Material · Voice',
    module: 'jobs',
    width: 'wide',
    render: () => <MaterialView {...material} part="voice" />,
  },
  {
    id: 'jobs-contacts',
    label: 'Contacts · List and add',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <ContactsView
        contacts={contactRows}
        companies={[
          { id: 'co-1', name: 'The Halloran-Achterberg group' },
          { id: 'co-2', name: 'Tallow' },
          { id: 'co-3', name: 'Kestrel Bank' },
        ]}
        timezone="Europe/London"
      />
    ),
  },
  {
    id: 'jobs-contact',
    label: 'Contact · One person',
    module: 'jobs',
    width: 'narrow',
    render: () => <ContactDetail contact={contact} timezone="Europe/London" />,
  },
  {
    id: 'jobs-find',
    label: 'Find',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <>
        <PageHeader title="Find" />
        <FindView {...findView} />
      </>
    ),
  },
  {
    id: 'jobs-recommended-roles',
    label: 'Find · Recommended roles',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <RecommendedRoles
        suggestions={recommendedRoles}
        stats={recommendedStats}
        searchCostMicros={4_200_000}
        searchLine={{ running: false, tone: 'plain', text: 'The search 2 hours ago found 3 new roles. Read 58 job boards, 12 postings worth a look.' }}
      />
    ),
  },
  {
    /* The same page on its table view, which was the Roles page (plan #1590),
     * still on the live applications. */
    id: 'jobs-roles-table',
    label: 'Pipeline · Table',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelinePage rows={pipelineRows} params={{ view: 'table' }} />,
  },
  {
    /* The table as a number on Today opens it (plan #1591): narrowed to one
     * stage, with the filter shown as a chip that takes it off. */
    id: 'jobs-pipeline-filtered',
    label: 'Pipeline · Opened from Today',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <PipelinePage rows={pipelineRows} params={{ view: 'table', stage: 'submitted' }} />
    ),
  },
  {
    /* Now, where Jobs opens (plan #1591, #1937.9): This week's interviews
     * and the live applications by whose move it is, with what came in
     * since in the rail. What asks for an action is on jobs-inbox. */
    id: 'jobs-today',
    label: 'Now',
    module: 'jobs',
    width: 'wide',
    render: () => <JobsTodaySurface />,
  },
  {
    /* The same page in a week with no interviews, so This week is one line. */
    id: 'jobs-today-clear',
    label: 'Now · a quiet week',
    module: 'jobs',
    width: 'wide',
    render: () => <JobsTodaySurface board={{ ...todayBoard, interviews: [] }} />,
  },
  {
    /* Analytics: how far each channel's applications got (plan #1595). */
    id: 'jobs-insights',
    label: 'Analytics · By channel',
    module: 'jobs',
    width: 'wide',
    render: () => <JobsInsightsSurface />,
  },
  {
    /* The month grid, which is the todo module's densest surface and the one
     * with a phone layout of its own. */
    id: 'todo-calendar-month',
    label: 'Calendar · A month',
    module: 'todo',
    width: 'wide',
    render: () => (
      <CalendarMonthGrid
        days={calendarDays}
        timezone="Europe/London"
        newEventHref={(day) => `/todo/calendar?new=${day}`}
        eventHref={(id) => `/todo/calendar?event=${id}`}
        feedEventHref={(id) => `/todo/calendar?feedEvent=${id}`}
      />
    ),
  },
  {
    /* A subscribed appointment, opened (plan #1374): what the organiser wrote,
     * the calendar it came from, and one task already about this date of it. */
    id: 'todo-feed-event',
    label: 'Calendar · A subscribed appointment',
    module: 'todo',
    width: 'narrow',
    render: () => (
      <FeedEventCard
        detail={{
          feedName: 'Work',
          event: {
            id: '00000000-0000-4000-8000-000000001374',
            feedId: '00000000-0000-4000-8000-000000000f01',
            title: 'Quarterly planning',
            body: 'Bring the Q4 numbers.\nAgenda to follow.',
            location: 'Room 4.02 / https://meet.example.com/q4-plan',
            startsOn: null,
            endsOn: null,
            startsAt: '2026-09-10T09:00:00.000Z',
            endsAt: '2026-09-10T10:30:00.000Z',
            createdAt: '2026-09-01T08:00:00.000Z',
          },
        }}
        view="month"
        anchor={CALENDAR_TODAY}
        timezone="Europe/London"
        tasks={[
          {
            id: 'feed-task-1',
            title: 'Pull the Q4 numbers together',
            body: null,
            status: 'open',
            dueOn: '2026-09-09',
            dueAt: null,
            pinned: false,
            snoozedUntil: null,
            completedAt: null,
            createdAt: '2026-09-02T08:00:00.000Z',
            position: null,
            parentId: null,
          },
        ]}
      />
    ),
  },
  {
    /* Quick note triage (plan #1729): the waiting quick notes as a deck, each
     * with its suggested notes, a search, and a note of its own; Leave for
     * later is the forward press. The list of all waiting folds below. */
    id: 'vault-triage',
    label: 'Vault · Quick note triage',
    module: 'vault',
    width: 'narrow',
    interaction: {
      kind: 'swipe',
      target: '[data-deck-item] [data-triage-text]',
      direction: 'left',
      shows: 'The quick note follows the finger left, then the next one comes in as it leaves.',
    },
    deck: { next: '[data-deck-next]', item: '[data-deck-item]' },
    render: () => (
      <div className={SHELL_FOOT}>
        <PageHeader subject={{ ref: null, path: triageCrumbs }} title="Quick note triage" />
        <TriagePreview writable />
      </div>
    ),
  },
  {
    /* Make it a note of its own, pressed (note 24fd1e02): the name field,
     * filled with the name the first line gives it, ready to change. */
    id: 'vault-triage-naming',
    label: 'Vault · Quick note triage · Naming a new note',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <div className={SHELL_FOOT}>
        <PageHeader subject={{ ref: null, path: triageCrumbs }} title="Quick note triage" />
        <TriagePreview writable naming />
      </div>
    ),
  },
  {
    /* Triage on its second note (plan #1931.5): the first is left for later,
     * so Previous sits beside the forward press. */
    id: 'vault-triage-previous',
    label: 'Vault · Quick note triage, Previous',
    module: 'vault',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-deck-previous]',
      shows: 'Previous brings the first note back under the finger, as it was left.',
    },
    deck: { next: '[data-deck-next]', item: '[data-deck-item]' },
    render: () => (
      <div className={SHELL_FOOT}>
        <PageHeader subject={{ ref: null, path: triageCrumbs }} title="Quick note triage" />
        <TriagePreview writable second />
      </div>
    ),
  },
  {
    /* Triage with nothing waiting: the deck's last word. */
    id: 'vault-triage-empty',
    label: 'Vault · Quick note triage, empty',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <>
        <PageHeader subject={{ ref: null, path: triageCrumbs }} title="Quick note triage" />
        <TriagePreview empty writable />
      </>
    ),
  },
  {
    /* Triage under a vault token that can only read: the reason in place of
     * the buttons, and the suggestions as links. */
    id: 'vault-triage-read-only',
    label: 'Vault · Quick note triage, read-only token',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <div className={SHELL_FOOT}>
        <PageHeader subject={{ ref: null, path: triageCrumbs }} title="Quick note triage" />
        <TriagePreview writable={false} />
      </div>
    ),
  },
  {
    /* New note on the vault page (note 09ff8039), opened from the header's
     * one action: the name, the note, and the press that commits it to the
     * vault's Inbox. */
    id: 'vault-new-note',
    label: 'Vault · New note',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <>
        <PageHeader
          title="Vault"
          description="knightx4/notes · main"
          actions={<span className={buttonVariants({ size: 'sm' })}>New note</span>}
        />
        <NewVaultNote />
        <QuickNoteRow waiting={3} writable />
      </>
    ),
  },
  {
    /* Add a quick note on the vault page (plan #1730): the button beside the
     * Quick note triage row, with its text box open and a long thought in it. */
    id: 'vault-quick-note',
    label: 'Vault · Add a quick note',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <>
        <PageHeader
          title="Vault"
          description="knightx4/notes · main"
          actions={<span className={buttonVariants({ size: 'sm' })}>New note</span>}
        />
        <QuickNoteRow
          waiting={12}
          writable
          startOpen
          startText="Idea for the kitchen shelves: use the oak offcuts from the garage, ask Dad about the bracket drill he borrowed in March, and check whether the landlord needs to approve anything before I drill into the tiled wall by the window."
        />
      </>
    ),
  },
  {
    /* The same button under a vault token that can only read: it says why. */
    id: 'vault-quick-note-read-only',
    label: 'Vault · Add a quick note, read-only token',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <>
        <PageHeader
          title="Vault"
          description="knightx4/notes · main"
          actions={<span className={buttonVariants({ size: 'sm' })}>New note</span>}
        />
        <QuickNoteRow waiting={0} writable={false} startOpen />
      </>
    ),
  },
  {
    /* A note, read. The vault has almost no chrome, so what there is to judge
     * is the prose styles and the properties table above them. */
    id: 'vault-note',
    label: 'Note · Properties and body',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <>
        <NoteProperties frontmatter={noteFrontmatter} />
        <NoteBody markdown={noteMarkdown} />
      </>
    ),
  },
  {
    /* Editing a note in place (plan #1425): at rest, the note with Edit beside
     * its title; the editor is the same component after a press. */
    id: 'vault-note-edit',
    label: 'Note · Edit button',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <NoteEdit
        notePath="Work/Nightly close.md"
        body={noteMarkdown}
        blobSha="preview"
        heading={
          <header>
            <h1 className="font-display text-title font-semibold tracking-tight text-ink">
              Nightly close
            </h1>
            <p className="mt-1 text-ui text-ink-muted">Work/ · updated 30 Aug 2026</p>
          </header>
        }
        properties={<NoteProperties frontmatter={noteFrontmatter} />}
      >
        <NoteBody markdown={noteMarkdown} />
      </NoteEdit>
    ),
  },
  {
    /* The editor open, and the two refusals that come with a way forward:
     * changed in Obsidian (reload) and a token that cannot write (settings). */
    id: 'vault-note-editing',
    label: 'Note · Editing, and a refused save',
    module: 'vault',
    width: 'narrow',
    render: () => <NoteEditingPreview body={noteMarkdown} />,
  },
  {
    /* Renaming a note (note 69c302f1): the file's name in a box where the
     * title was, with Rename and Cancel under it. */
    id: 'vault-note-rename',
    label: 'Note · Renaming',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <NoteRenamePreview>
        <NoteProperties frontmatter={noteFrontmatter} />
        <NoteBody markdown={noteMarkdown} />
      </NoteRenamePreview>
    ),
  },
  {
    /* A note's embedded files (plan #1302): an image, a sized one, a PDF, a
     * recording, and the four ways a file can be unavailable. The images are
     * drawn from data URLs here; on the page they come through the signed
     * /vault/attachment route. */
    id: 'vault-note-attachments',
    label: 'Note · Embedded files',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <NoteBody
        markdown={toStandardMarkdown(attachmentNote, { index: buildLinkIndex([]), hrefFor: noteHref })}
        notePath="Home/Moving flat.md"
        attachments={buildAttachmentIndex(attachmentRows)}
        hrefForAttachment={(entry) => attachmentPictures[entry.id] ?? '#'}
      />
    ),
  },
  {
    /* The tab with jobs above the courses (plan #1991.4): the job held now
     * first, a row the person corrected, one they added with no title, a
     * long employer, and the note offering to read a changed résumé again. */
    id: 'you-work-jobs',
    label: 'Work & school · Jobs from your résumé',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <JobsSection jobs={workHistoryJobs} resume={workHistoryResume} changed />
        <EducationSection groups={educationGroups} courseCounts={educationCounts} transcripts={2} courses={9} />
      </>
    ),
  },
  {
    /* No jobs yet, with a résumé in Jobs to read: the press that lists them. */
    id: 'you-work-jobs-empty',
    label: 'Work & school · No jobs yet',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <JobsSection jobs={[]} resume={workHistoryResume} changed={false} />
        <EducationSection groups={[]} courseCounts={{}} transcripts={0} courses={0} />
      </>
    ),
  },
  {
    /* Correcting a job in place: the row's form open, the rest of the list around it. */
    id: 'you-work-jobs-edit',
    label: 'Work & school · Correcting a job',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <JobsSection jobs={workHistoryJobs} resume={workHistoryResume} changed={false} editing="j-ey" />
      </>
    ),
  },
  {
    /* Work & school with no transcripts yet (plan #1308, moved to You by
     * #1991.3): the empty state says what to upload. */
    id: 'you-work-empty',
    label: 'Work & school · No transcripts yet',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <EducationSection groups={[]} courseCounts={{}} transcripts={0} courses={0} />
      </>
    ),
  },
  {
    /* Choosing a transcript or pasting its text, before Dash reads it. */
    id: 'you-work-upload',
    label: 'Work & school · Upload a transcript',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <SectionHeading title="Education" className="mb-2" />
        <EducationUploadPreview />
      </>
    ),
  },
  {
    /* The courses Dash read, to check before saving: a school it found, a
     * course with no grade, and a transfer course showing its own school. */
    id: 'you-work-check',
    label: 'Work & school · Check before saving',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <SectionHeading title="Education" className="mb-2" />
        <EducationCheckPreview />
      </>
    ),
  },
  {
    /* Saved courses by school and then by term, newest first, with the
     * transcripts each school issued. A graded course named for its topics
     * offers its one explain prompt, and one already explained says what
     * the answer showed (plan #2172.4.2). */
    id: 'you-work-list',
    label: 'Work & school · Courses by school and term',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <EducationSection
          groups={educationGroups}
          courseCounts={educationCounts}
          transcripts={2}
          courses={9}
          explains={educationExplains}
        />
      </>
    ),
  },
  {
    /* A course's explain prompt open on its row (plan #2172.4.2): the
     * question naming the topics the course was named for, the box, and the
     * press that grades it. */
    id: 'you-work-explain',
    label: 'Work & school · Explaining a course',
    module: 'you',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Work & school" />
        <EducationSection
          groups={educationGroups}
          courseCounts={educationCounts}
          transcripts={2}
          courses={9}
          explains={educationExplains}
          explaining="c3"
        />
      </>
    ),
  },
  {
    /* The track opens with a button in its header, where the box used to sit
     * at the foot (plan #1950.6). */
    id: 'learn-track-header',
    label: 'Track · Add something to read',
    module: 'learn',
    width: 'narrow',
    render: () => (
      <PageHeader
        title="Central banking"
        description="3 to go · 2 read"
        actions={<AimButton aim={{ kind: 'track-reading' }} label="Add something to read" variant="secondary" />}
      />
    ),
  },
  {
    /* A track's readings, in the one surface the module is read on. The list
     * is the page: everything else on /learn/t/[id] is a header and a form. */
    id: 'learn-track-readings',
    label: 'Track · The readings',
    module: 'learn',
    width: 'narrow',
    render: () => (
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {trackReadings.map((reading) => (
          <ReadingCard key={reading.id} reading={reading} />
        ))}
      </ul>
    ),
  },
  {
    /* "Dash is on it" on a row while a run or an Ask Dash hand-off is about
     * it (plan #1964.2.2), in the three workspaces whose rows had no move of
     * their own: a reading, a vault note and a newsletter issue. The press
     * starts a run about the reading with no source; the note and the issue
     * are drawn with a run already going. */
    id: 'dash-working-rows',
    label: 'Rows · Dash is on it',
    module: 'learn',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="dash-row"]',
      shows:
        'Pressing “Find a source” turns the button’s mark to working beside its words, which become “Finding a source”, and on the reading with no source “No source yet” gives way to Dash’s pulsing mark and “Dash is on it” in the same place, with nothing below moving.',
    },
    render: () => (
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">Learn · Distributed systems</h2>
          <DashWorkingReadingDemo readings={trackReadings.slice(1, 4)} target="rd4" />
        </section>
        <section>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">Vault · Work</h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {workingNotes.map((note) => (
              <NoteListRow key={note.id} note={note} working={['obsidian.notes:Work/What I want from the next role.md']} />
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">News · Latest</h2>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {workingIssues.map((issue) => (
              <IssueListRow
                key={issue.id}
                issue={issue}
                sender={workingSenders.get(issue.senderId)}
                from={null}
                timezone="Europe/London"
                working={['news.issues:wi1']}
              />
            ))}
          </ul>
        </section>
      </div>
    ),
  },
  {
    /* Due for review on Learn now (note 9b011a39): the list folds under its
     * heading, with the count on the closed line. Fixtures in
     * notes-batch-surfaces.tsx. */
    id: 'learn-review-list',
    label: 'Now · Due for review',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnReviewListSurface />,
  },
  {
    /* The same list folded shut: one line, the chevron, Due for review and
     * the count (note 9b011a39). */
    id: 'learn-review-list-folded',
    label: 'Now · Due for review, folded',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnReviewListSurface folded />,
  },
  {
    /* Learn now as a deck: one card, the three swipes at its foot. Nothing
     * here is recorded; the swipes only reach the server from the real page. */
    id: 'learn-now-deck',
    label: 'Now · One card at a time',
    module: 'learn',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-deck-previous]',
      shows: 'Previous puts the card just passed back on top.',
    },
    // On its second card (plan #1931.5): the first is passed, so Previous shows.
    render: () => (
      <LearnNowFeed first={deckCards.slice(1)} earlier={deckCards.slice(0, 1)} ready={20} low={10} />
    ),
  },
  /* Today's piece, which leads the deck (plan #2164.4) as a thread with Dash
   * (plan #2164.5), and its hidden parts: the check as the last turn, the
   * finished thread, an answer being marked, a mark that failed, and a goal
   * with no pieces yet. */
  {
    id: 'learn-now-deck-piece',
    label: 'Now · Today’s piece, an idea marked',
    module: 'learn',
    width: 'narrow',
    render: () => <TodaysPieceSurface />,
  },
  {
    id: 'learn-now-deck-piece-check',
    label: 'Now · Today’s piece, the check as the last turn',
    module: 'learn',
    width: 'narrow',
    render: () => <TodaysPieceCheckSurface />,
  },
  {
    id: 'learn-now-deck-piece-done',
    label: 'Now · Today’s piece, finished',
    module: 'learn',
    width: 'narrow',
    render: () => <TodaysPieceDoneSurface />,
  },
  {
    id: 'learn-now-deck-piece-loading',
    label: 'Now · Today’s piece, an answer being marked',
    module: 'learn',
    width: 'narrow',
    render: () => <TodaysPieceLoadingSurface />,
  },
  {
    id: 'learn-now-deck-piece-error',
    label: 'Now · Today’s piece, a mark that failed',
    module: 'learn',
    width: 'narrow',
    render: () => <TodaysPieceErrorSurface />,
  },
  {
    id: 'learn-now-deck-piece-none',
    label: 'Now · A goal with no pieces yet',
    module: 'learn',
    width: 'narrow',
    render: () => (
      // Enough cards that the deck does not reach for more, which the gallery cannot load.
      <TodaysPieceNoneSurface
        cards={
          <LearnNowFeed
            first={[...deckCards, ...deckCards.map((card, index) => ({ ...card, id: `${card.id.slice(0, -1)}${'abc'[index]}` }))]}
            ready={20}
            low={10}
          />
        }
      />
    ),
  },
  {
    /* Now opened from a subject's page (plan #1698), with nothing of it
     * ready, under the longest subject name: the link back naming the
     * subject, the switch, and the empty state. Its cards are drawn by the
     * deck above, which is the same component. */
    id: 'learn-now-subject-empty',
    label: 'Now · One subject, nothing ready',
    module: 'learn',
    width: 'narrow',
    render: () => (
      <>
        <NowHeader practice={false} subject={nowSubjectLong} />
        <LearnNowFeed first={[]} ready={0} low={10} subjectId={nowSubjectLong.id} />
      </>
    ),
  },
  {
    /* A research brief's quick read (plan #2023.6): the cards written from
     * its sources, one at a time, with Not interested at the start of the
     * forward row. Dismissing one here dismisses it in Learn now too. */
    id: 'learn-brief-quick',
    label: 'Brief · Quick read',
    module: 'learn',
    width: 'narrow',
    interaction: {
      kind: 'swipe',
      target: '[data-deck-item] h2',
      direction: 'left',
      shows: 'The card follows the finger left, then the next source’s card comes in as it leaves.',
    },
    deck: { next: '[data-deck-next]', item: '[data-deck-item]' },
    render: () => (
      <div className={SHELL_FOOT}>
        <BriefQuickPreview state="deck" />
      </div>
    ),
  },
  {
    /* The quick read while the brief is still researching: no cards yet,
     * and the way back to the brief. */
    id: 'learn-brief-quick-empty',
    label: 'Brief · Quick read, still researching',
    module: 'learn',
    width: 'narrow',
    render: () => <BriefQuickPreview state="researching" />,
  },
  {
    /* The quick read after its last card: done, and back to the brief. */
    id: 'learn-brief-quick-end',
    label: 'Brief · Quick read, every card read',
    module: 'learn',
    width: 'narrow',
    render: () => <BriefQuickPreview state="end" />,
  },
  {
    /* Learn now with a card from a research brief's source on top (plan
     * #2023.6): the why line names the research, the source is named under
     * the title, and Open the brief stands in for Save and Test me. */
    id: 'learn-now-research-card',
    label: 'Now · A card from your research',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnNowResearchPreview />,
  },
  {
    /* The same card when a brief's weekly check found its source (plan
     * #2023.8): marked as a new source until it is opened. */
    id: 'learn-now-research-card-new',
    label: 'Now · A new source from a watched topic',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnNowResearchNewPreview />,
  },
  {
    /* The courses fold on Learn's Tracks page with no transcript saved: it
     * points to You's Work & school tab (plan #1391). */
    id: 'learn-courses-empty',
    label: 'Tracks · Courses, none saved',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnCoursesEmptyPreview />,
  },
  {
    /* Courses by school and term, one read into a track, one whose track
     * was removed, each with its read button (plan #1391). */
    id: 'learn-courses-list',
    label: 'Tracks · Courses by school and term',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnCoursesListPreview />,
  },
  {
    /* One course being checked: its term and grade, the track picker, an
     * idea the track already holds, and the ticks (plan #1391). */
    id: 'learn-course-check',
    label: 'Tracks · Checking a course',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnCourseCheckPreview />,
  },
  {
    /* A Learn-area goal's Learning section: how well you want to know it,
     * its plan and the Practise link (plan #1491, from Learn's old Goals tab). */
    id: 'learn-goals-list',
    label: 'Goals · A learning goal, with Practise',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnGoalsPreview />,
  },
  {
    /* Practice Flow's filter with Goals only chosen, and the line a goal's
     * Practise link opens on in its place (plan #1387). */
    id: 'learn-flow-scope',
    label: 'Practice Flow · The filter and a goal focus',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowScopePreview />,
  },
  {
    /* A goal question in Practice Flow (plan #2164.2): an idea to explain in a
     * few sentences, with the box to write in, Mark it, I don't know and Later. */
    id: 'learn-flow-explain',
    label: 'Practice Flow · An explain question',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowExplainPreview stage="ask" />,
  },
  {
    /* The explanation marked: what was right, what was missing, the example
     * line, and the one follow-up with its own box. Next skips it. */
    id: 'learn-flow-explain-marked',
    label: 'Practice Flow · Explanation marked, with the follow-up',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowExplainPreview stage="marked" />,
  },
  {
    /* The follow-up marked too: where the idea now stands, the idea as
     * written, and Next. */
    id: 'learn-flow-explain-done',
    label: 'Practice Flow · Follow-up marked',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowExplainPreview stage="done" />,
  },
  {
    /* Mark it pressed: the press held while Dash marks the explanation. */
    id: 'learn-flow-explain-grading',
    label: 'Practice Flow · Marking the explanation',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowExplainPreview stage="grading" />,
  },
  {
    /* What a session moved (plan #2164.6): the card that ends a Practice Flow
     * run, with the ideas shown and missed quoted and what came onto the fringe. */
    id: 'learn-flow-summary',
    label: 'Practice Flow · What moved',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowSummaryPreview />,
  },
  {
    /* Marking failed: the explanation stays in its box, with the reason under the card. */
    id: 'learn-flow-explain-error',
    label: 'Practice Flow · Marking failed',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowExplainPreview stage="error" />,
  },
  {
    /* An explain question about one level of a topic, before an answer
     * (plan #2138.5). The forward row holds Check my answer. */
    id: 'learn-cell-answer',
    label: 'Practice Flow · Explain a level',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="asked" />,
  },
  {
    /* The same question while the answer is graded. */
    id: 'learn-cell-answer-loading',
    label: 'Practice Flow · Explain a level, grading',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="loading" />,
  },
  {
    /* Grading failed: the answer stays in the box to send again. */
    id: 'learn-cell-answer-error',
    label: 'Practice Flow · Explain a level, grading failed',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="error" />,
  },
  {
    /* The answer screen: every level the answer reached, shown or implied,
     * and a link put up for review. */
    id: 'learn-cell-answer-reached',
    label: 'Practice Flow · What an answer reached',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="reached" />,
  },
  {
    /* The same list with the quote behind the first shown level opened. */
    id: 'learn-cell-answer-quote',
    label: 'Practice Flow · What an answer reached, quote open',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="quote" />,
  },
  {
    /* A case at level 4: numbers to work and a box to show the working in
     * (plan #2138.8). */
    id: 'learn-cell-answer-case',
    label: 'Practice Flow · Work a case',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="case" />,
  },
  {
    /* The same case graded on the asked level alone. */
    id: 'learn-cell-answer-case-reached',
    label: 'Practice Flow · Work a case, graded',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="case-reached" />,
  },
  {
    /* A question Practice Flow picked (plan #2138.6), with the reason it was
     * chosen opened, and End run beside the forward action. */
    id: 'learn-practice-why',
    label: 'Practice Flow · Why this question',
    module: 'learn',
    width: 'narrow',
    render: () => <CellAnswerPreview state="asked" openWhy />,
  },
  {
    /* The end of a run: every level that moved while it lasted. */
    id: 'learn-practice-run-end',
    label: 'Practice Flow · End of a run',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="end" />,
  },
  {
    /* The end of a run with a lens offered for a vault theme no lens covers. */
    id: 'learn-practice-run-end-offer',
    label: 'Practice Flow · End of a run, lens offered',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="end-offer" />,
  },
  {
    /* The same offer with the longest names it has to hold. */
    id: 'learn-practice-run-end-offer-long',
    label: 'Practice Flow · End of a run, lens offered, long names',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="end-offer-long" />,
  },
  {
    /* A run ended before anything was answered. */
    id: 'learn-practice-run-end-empty',
    label: 'Practice Flow · End of a run, nothing answered',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="end-empty" />,
  },
  {
    /* A run that ended because nothing was left to ask. */
    id: 'learn-practice-run-end-nothing-left',
    label: 'Practice Flow · End of a run, nothing left',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="end-nothing-left" />,
  },
  {
    /* The next question while it is chosen and written. */
    id: 'learn-practice-loading',
    label: 'Practice Flow · Choosing the next question',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="loading" />,
  },
  {
    /* No approved topic to place you on. */
    id: 'learn-practice-no-topic',
    label: 'Practice Flow · No topic yet',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="no-topic" />,
  },
  {
    /* The next question could not be chosen. */
    id: 'learn-practice-error',
    label: 'Practice Flow · Choosing failed',
    module: 'learn',
    width: 'narrow',
    render: () => <PracticeRunPreview state="error" />,
  },
  {
    /* The chain a subject reads as: the doors it turns on, then everything
     * downstream of them. The size difference is the surface. */
    id: 'learn-subject-chain',
    label: 'Subject · Doors and what follows',
    module: 'learn',
    width: 'narrow',
    render: () => (
      <ConceptList concepts={subjectConcepts} nextId="k1" subjectId="s1" timezone="Europe/London" />
    ),
  },
  {
    id: 'jobs-interviews',
    label: 'Interviews · Upcoming and past',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <>
        <RoundsTable title="Upcoming" rows={interviewRounds.slice(0, 2)} timezone="Europe/London" />
        <RoundsTable title="Past" rows={interviewRounds.slice(2)} timezone="Europe/London" />
      </>
    ),
  },

  {
    /* The shared display control and the shared group header, before any page
     * uses either. Both at once because they are two halves of one idea: the
     * panel says how the list is arranged and the header is where a grouping
     * proves it is a grouping rather than a reordering. */
    id: 'shell-display-options',
    label: 'Display options · Control and group headers',
    module: 'shopping',
    width: 'wide',
    render: () => <SharedDisplayOptions />,
  },

  {
    /* The top bar's search field on its own. It is a button drawn as a
     * field: pressing it opens the search box on everything you own (plan
     * #1363), which here does nothing because the shell is not around it.
     * In a workspace its chip reads Everything and offers the workspace
     * (plan #1364). */
    id: 'shell-search-bar',
    label: 'Top bar · Search field',
    module: 'jobs',
    width: 'narrow',
    render: () => (
      <div className="py-4">
        <SearchBarSurface />
      </div>
    ),
  },

  {
    /* The search box as the phone's dock button opens it (note 5f3ef44f):
     * the switcher and the search in one, so before anything is typed it
     * lists every workspace, Home first, the one you are in marked. */
    id: 'shell-go-to',
    label: 'Dock · Go to, before anything is typed',
    module: 'jobs',
    width: 'narrow',
    render: () => <GoToSurface />,
  },

  {
    /* The one capture box (plan #1581) that the plus in the top bar and ⌥C
     * open: the line under the field while a sentence is typed, the chips
     * when Dash is not sure, and where three filed things went. */
    id: 'shell-capture',
    label: 'Top bar · Capture anything',
    module: 'todo',
    width: 'narrow',
    render: () => <CaptureBoxSurface />,
  },
  {
    /* Capture aimed at a kind (plan #1950.1), what an Add button on a list
     * opens: a todo with its day, a note on a role, and the toast with Undo
     * that one press leaves. */
    id: 'shell-capture-aimed',
    label: 'Capture · Aimed by an Add button',
    module: 'todo',
    width: 'narrow',
    render: () => <AimedCaptureSurface />,
  },
  {
    /* Capture aimed at Shopping's three lists (plan #1950.3.1): an order
     * from a sentence with its $ hint, an ISBN being added, a link missing,
     * and the toast one press leaves. */
    id: 'shell-capture-aimed-shopping',
    label: 'Capture · Aimed at an order, an item or a link',
    module: 'shopping',
    width: 'narrow',
    render: () => <ShoppingAimedSurface />,
  },
  {
    /* The camera step inside capture aimed at Shopping (plan #1950.3.2): a
     * receipt photo taken, the barcode viewfinder open, a scan being looked
     * up, the book it named, and a barcode nothing lists. */
    id: 'shell-capture-aimed-camera',
    label: 'Capture · A receipt photo and a barcode scan',
    module: 'shopping',
    width: 'narrow',
    render: () => <ShoppingAimedCameraSurface />,
  },
  {
    /* The Add buttons on Orders and Inventory (plan #1950.3.1), in the
     * header and on the empty list, each opening capture aimed at its kind. */
    id: 'shopping-list-adds',
    label: 'Shopping · Add on Orders and Inventory',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingListAddsSurface />,
  },
  {
    /* Capture aimed at the Jobs and Learn kinds (plan #1950.4): a role from
     * a posting link while the page is read, a topic with a reading list
     * pasted under it, and a quiz naming a note the vault does not have. */
    id: 'shell-capture-aimed-jobs-learn',
    label: 'Capture · Aimed at a role, a topic or a quiz',
    module: 'learn',
    width: 'narrow',
    render: () => <AimedJobsLearnSurface />,
  },

  {
    /* Ask Dash (plan #1090): the sheet the Dash button in the top bar opens,
     * over the same shell as below, first on a new question with the earlier
     * ones under it, then with an answer and the rows it used. Fixtures
     * stand in for the server actions (ask-surfaces.tsx). */
    id: 'ask-dash-new',
    label: 'Ask Dash · A new question',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    id: 'ask-dash-answer',
    label: 'Ask Dash · An answer with its rows',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question="What did I spend on eBay flips this quarter?">
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* An answer being written (plan #1902): the lookup that ran sits under
     * Dash's name, and the answer's first sentences follow it as they arrive,
     * the mark showing Dash writing. The fixture holds it there. */
    id: 'ask-dash-writing',
    label: 'Ask Dash · An answer being written',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question={WRITING_QUESTION}>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* Dash at work in the sheet (plan #1899.8): Send pressed on a question,
     * each lookup appearing under Dash's name as it is made, the answer's
     * words after them, and the mark coming to rest when it lands. */
    id: 'ask-dash-at-work',
    label: 'Ask Dash · Dash at work',
    module: 'jobs',
    width: 'page',
    interaction: {
      kind: 'press',
      target: 'button[type="submit"][title="Send"]',
      submits: true,
      shows:
        'Send answers at once and the mark starts working; the lookup lines appear one after another under Dash, the answer is written out after them, and the mark comes to rest on the finished answer.',
    },
    render: () => (
      <AskDashSurface open draft={AT_WORK_QUESTION}>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* An answer that failed (plan #1337): the question was kept, the answer
     * was not, and Dash's mark shows failed with the error beside it where
     * the working line was. */
    id: 'ask-dash-failed',
    label: 'Ask Dash · An answer that failed',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question={FAILING_QUESTION}>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* The page Dash will be told (plan #1272): opened over a goal, the chip
     * above the question box names the goal, with an × to leave it out. */
    id: 'ask-dash-page',
    label: 'Ask Dash · The page it will be told',
    module: 'goals',
    width: 'page',
    render: () => (
      <AskDashSurface open page={TRIP_GOAL}>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* A filtered list sent to Dash (plan #1658): the Pipeline narrowed to one
     * source, the sheet opened from its button with "N roles from Pipeline"
     * above the question box in place of the page's name. */
    id: 'ask-dash-rows',
    label: 'Ask Dash · A filtered list sent with the question',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open page="/jobs/pipeline" rows={{ ...FILTERED_PIPELINE, label: FILTERED_PIPELINE_LABEL }}>
        <PreviewShell>
          <PipelinePage rows={pipelineRows} params={FILTERED_PIPELINE_PARAMS} />
        </PreviewShell>
      </AskDashSurface>
    ),
  },
  {
    /* A change Dash proposes (plan #1190): asked to add something, the answer
     * carries a card per change with Confirm and Decline, and nothing is
     * written until one is pressed. */
    id: 'ask-dash-proposal',
    label: 'Ask Dash · Changes to confirm',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question="Add a todo to call the dentist on Friday, and a step to book the hygienist">
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* The same cards reopened later, as /ask/<ref> and the sheet draw them:
     * done with a link and Undo, declined, undone, and one still waiting. */
    id: 'ask-dash-changes',
    label: 'Ask Dash · Changes reopened',
    module: 'jobs',
    width: 'page',
    render: () => <AskChangesSurface />,
  },
  {
    /* Ask Dash asked to build plan steps (plan #2106.1): a card naming the
     * step with Confirm and Decline, one whose last run has gone quiet, and
     * a step that cannot be built, refused in words with no card. */
    id: 'ask-dash-build',
    label: 'Ask Dash · Start a build',
    module: 'dev',
    width: 'page',
    render: () => <AskBuildSurface />,
  },
  {
    /* The "Are you sure?" popup Confirm opens on a proposed delete (plan
     * #2232.2): the answers listed, Cancel focused, Delete beside it. */
    id: 'ask-dash-delete-popup',
    label: 'Ask Dash · Delete, are you sure',
    module: 'jobs',
    width: 'page',
    render: () => <AskDeleteSurface />,
  },
  {
    /* The same popup after Delete was turned down: the reason inside, the rows kept. */
    id: 'ask-dash-delete-popup-refused',
    label: 'Ask Dash · Delete, refused',
    module: 'jobs',
    width: 'page',
    render: () => <AskDeleteSurface mode="refused" />,
  },
  {
    /* The popup while the delete runs: both buttons held, Delete working. */
    id: 'ask-dash-delete-popup-deleting',
    label: 'Ask Dash · Delete, running',
    module: 'jobs',
    width: 'page',
    render: () => <AskDeleteSurface mode="deleting" />,
  },
  {
    /* The build card after a Confirm the server refused, the reason under it. */
    id: 'ask-dash-build-refused',
    label: 'Ask Dash · Start a build, refused',
    module: 'dev',
    width: 'page',
    render: () => <AskBuildSurface refused />,
  },
  {
    /* What costs money, on one card under the answer that queued it (plan
     * #2228.2): a cost on each line, the total, Accept all and Decline. */
    id: 'ask-dash-paid',
    label: 'Ask Dash · Paid actions waiting',
    module: 'jobs',
    width: 'page',
    render: () => <AskPaidSurface />,
  },
  {
    /* Accept all pressed: the first line running, the rest waiting their turn. */
    id: 'ask-dash-paid-running',
    label: 'Ask Dash · Paid actions running',
    module: 'jobs',
    width: 'page',
    render: () => <AskPaidSurface moment="running" />,
  },
  {
    /* Every line run: each links to what it wrote, and none has an Undo. */
    id: 'ask-dash-paid-done',
    label: 'Ask Dash · Paid actions run',
    module: 'jobs',
    width: 'page',
    render: () => <AskPaidSurface moment="done" />,
  },
  {
    /* One line refused with its reason; the lines either side of it still ran. */
    id: 'ask-dash-paid-failed',
    label: 'Ask Dash · A paid action that failed',
    module: 'jobs',
    width: 'page',
    render: () => <AskPaidSurface moment="failed" />,
  },
  {
    /* Declined: the card greyed, nothing run and nothing spent. */
    id: 'ask-dash-paid-declined',
    label: 'Ask Dash · Paid actions declined',
    module: 'jobs',
    width: 'page',
    render: () => <AskPaidSurface moment="declined" />,
  },
  {
    /* The Ask page's list of changes Dash made (plan #1191): one of each kind
     * newest first, one undone, Undo on the step refused with its reason. */
    id: 'ask-made-changes',
    label: 'Ask · Changes Dash made',
    module: 'jobs',
    width: 'page',
    render: () => <AskMadeChangesSurface />,
  },
  {
    /* The Ask Dash thread on its own (plan #1708), where a change to
     * components/thread/thread.tsx without a subject is looked at: a short answer with its
     * rows, a long markdown one, one with bars, one with a table, and one
     * with a figure against the usual amount and columns by month. */
    id: 'ask-dash-thread',
    label: 'Ask Dash · The thread',
    module: 'jobs',
    width: 'page',
    render: () => <TalkThreadSurface />,
  },
  {
    /* A question with a bill's photo and PDF added (plan #1716): Dash reads
     * them with the question, and the $ beside Send, open, counts reading
     * them. */
    id: 'ask-dash-files',
    label: 'Ask Dash · A question with files',
    module: 'jobs',
    width: 'page',
    render: () => <TalkThreadFilesSurface />,
  },
  {
    /* Dash's page (plan #1899.2), the conversation pattern: the chats on the
     * left, grouped by day with the workspaces each used and chips to narrow
     * them, and the open chat beside them. On a phone the chat is drawn over
     * the list, with the way back above its title. */
    id: 'ask-page',
    label: 'Dash · A chat open beside the list',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface />,
  },
  {
    /* Dash at work on the full page (plan #1899.8): Send pressed in an open
     * chat, each lookup appearing under Dash's name, the answer written out
     * after them and the mark coming to rest. */
    id: 'ask-page-at-work',
    label: 'Dash · Dash at work in a chat',
    module: 'jobs',
    width: 'page',
    interaction: {
      kind: 'press',
      target: 'button[type="submit"][title="Send"]',
      submits: true,
      shows:
        'Send answers at once and the mark starts working; the lookup lines appear one after another under Dash, the answer is written out after them, and the mark comes to rest on the finished answer.',
    },
    render: () => <DashPageSurface listOpen={false} usedOpen={false} draft={AT_WORK_QUESTION} />,
  },
  {
    /* The same page at /ask, a new chat beside the list; on a phone the
     * list is the whole page. */
    id: 'ask-page-new',
    label: 'Dash · The list and a new chat',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface chat="new" />,
  },
  {
    /* The list hidden to its strip (New chat and the button to show it),
     * with the chat centred at its reading width. The column of what Dash
     * used is folded too, to its button in the chat's header (#1899.4). */
    id: 'ask-page-hidden',
    label: 'Dash · The list hidden',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface listOpen={false} usedOpen={false} />,
  },
  {
    /* What Dash used in the open chat (plan #1899.4): with the list hidden
     * there is room, so the column sits beside the chat: the rows read, the
     * change made with Undo, the lookups, the file sent and the cost. A
     * phone has no room, so the chat shows the Used button. */
    id: 'ask-page-used',
    label: 'Dash · What Dash used, beside the chat',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface listOpen={false} />,
  },
  {
    /* Dash's box (plan #1899.5): a question that carried two rows added
     * with @, shown under it; an answer stopped part way, kept as far as it
     * got; and the box open on "@cat" with the rows the top bar's search
     * finds, one already added as a chip, the scope chip on Shopping. */
    id: 'ask-box-rows',
    label: 'Dash · Adding a row with @',
    module: 'jobs',
    width: 'page',
    render: () => <AskBoxSurface open="rows" />,
  },
  {
    /* The same box with / typed: the things Dash can already do, each
     * written into the box for you to finish. */
    id: 'ask-box-commands',
    label: 'Dash · The commands / offers',
    module: 'jobs',
    width: 'page',
    render: () => <AskBoxSurface open="commands" />,
  },
  {
    /* The scope chip's menu open: Everything, or one workspace Dash's
     * lookups are kept to, Learn chosen. */
    id: 'ask-box-scope',
    label: 'Dash · Keeping the lookups to one workspace',
    module: 'jobs',
    width: 'page',
    render: () => <AskBoxSurface open="scope" />,
  },
  {
    /* The list searched for "Catan" (plan #1899.6): two chats found by what
     * was said in them, one only in Dash's answer, each with the words
     * around it. On a phone the list is the page. */
    id: 'ask-page-search',
    label: 'Dash · Searching the chats',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface chat="new" list="search" />,
  },
  {
    /* A chat's menu open in the list: pin, rename, archive (plan #1899.6). */
    id: 'ask-page-menu',
    label: "Dash · A chat's menu",
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface chat="new" list="menu" />,
  },
  {
    /* A chat being renamed in place in the list (plan #1899.6). */
    id: 'ask-page-rename',
    label: 'Dash · Renaming a chat',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface chat="new" list="rename" />,
  },
  {
    /* An archived chat opened from Archived at the foot of the list (plan
     * #1899.6), with the line above it that puts it back. */
    id: 'ask-page-archived',
    label: 'Dash · An archived chat',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface chat="archived" usedOpen={false} />,
  },
  {
    /* The presses under each answer (plan #1899.7): the first answer made a
     * todo and saved to the vault, each card with Undo, and Edit pressed on
     * the second, so its question is back in the box. */
    id: 'ask-answer-actions',
    label: 'Dash · An answer kept as a todo and a note',
    module: 'jobs',
    width: 'page',
    render: () => <AskAnswerActionsSurface />,
  },
  {
    /* The same column opened as a sheet from the right, as it opens on a
     * phone and on a laptop with the list shown. */
    id: 'ask-page-used-sheet',
    label: 'Dash · What Dash used, as a sheet',
    module: 'jobs',
    width: 'page',
    render: () => <DashPageSurface sheetOpen />,
  },

  {
    /* Learn's clip player (plan #1400): three clips queued, before the first
     * tap. A card in the page at every width. Fixtures in
     * clip-surfaces.tsx. */
    id: 'learn-clips',
    label: 'Learn · Clips',
    module: 'learn',
    width: 'page',
    render: () => <ClipStreamSurface />,
  },
  {
    /* One subject's Clips (plan #1697): the player under a long subject
     * name, with the counts in the rail from laptop width. */
    id: 'learn-subject-clips',
    label: 'Learn · Subject clips',
    module: 'learn',
    width: 'page',
    render: () => <SubjectClipsSurface />,
  },
  {
    /* The same page for a subject no clip serves yet. */
    id: 'learn-subject-clips-empty',
    label: 'Learn · Subject clips, none yet',
    module: 'learn',
    width: 'page',
    render: () => <SubjectClipsEmptySurface />,
  },
  {
    /* The list after the press: five articles to keep or strike, one with a very long title. (plan #2157.1). Fixtures in subject-articles-surfaces.tsx. */
    id: 'learn-subject-articles',
    label: 'Learn · Find articles, proposed list',
    module: 'learn',
    width: 'page',
    render: () => <SubjectArticlesSurface />,
  },
  {
    /* Mid-lookup, while idea names resolve one at a time. (plan #2157.1). Fixtures in subject-articles-surfaces.tsx. */
    id: 'learn-subject-articles-loading',
    label: 'Learn · Find articles, looking up',
    module: 'learn',
    width: 'page',
    render: () => <SubjectArticlesLoadingSurface />,
  },
  {
    /* Every article the ideas name is already in the catalogue. (plan #2157.1). Fixtures in subject-articles-surfaces.tsx. */
    id: 'learn-subject-articles-empty',
    label: 'Learn · Find articles, all held',
    module: 'learn',
    width: 'page',
    render: () => <SubjectArticlesEmptySurface />,
  },
  {
    /* Wikipedia did not answer. (plan #2157.1). Fixtures in subject-articles-surfaces.tsx. */
    id: 'learn-subject-articles-error',
    label: 'Learn · Find articles, Wikipedia down',
    module: 'learn',
    width: 'page',
    render: () => <SubjectArticlesErrorSurface />,
  },
  {
    /* The Big Five test (plan #1632): fifty statements, the first seven
     * answered. Fixtures in personality-surfaces.tsx. */
    id: 'you-personality-test',
    label: 'You · Personality test',
    module: 'you',
    width: 'page',
    render: () => <PersonalityTestSurface />,
  },
  {
    /* The same page opened with a result kept: the five scores. */
    id: 'you-personality-scores',
    label: 'You · Personality scores',
    module: 'you',
    width: 'page',
    render: () => <PersonalityScoresSurface />,
  },
  {
    /* Typing in a type from another test (plan #1633): the compose form
     * open beneath the scores, one type already kept. */
    id: 'you-personality-add-type',
    label: 'You · Personality, adding a type',
    module: 'you',
    width: 'page',
    render: () => <PersonalityAddTypeSurface />,
  },
  {
    /* The Big Five result on You's Personality tab (plan #1634, moved from
     * Learn's Know page by #1991.2): the five traits,
     * the vault themes nearest each, Dash's read against the notes (#1635)
     * with two clashes and two agreements, two typed-in types with their
     * reads folded, and one earlier result folded. Intellect has no theme
     * near it. */
    id: 'you-personality',
    label: 'You · Personality, a result read',
    module: 'you',
    width: 'page',
    render: () => <YouPersonalitySurface />,
  },
  {
    /* Straight after a save (plan #1635): Dash's read of the result is
     * still running, so the tab says so where the read will be. */
    id: 'you-personality-reading',
    label: 'You · Personality, being read',
    module: 'you',
    width: 'page',
    render: () => <YouPersonalityReadingSurface />,
  },
  {
    /* The same tab before any test is taken: one line offering it. */
    id: 'you-personality-empty',
    label: 'You · Personality, no test taken',
    module: 'you',
    width: 'page',
    render: () => <YouPersonalityEmptySurface />,
  },
  {
    /* Idea Space (plan #1857), a night sky since plan #1997.6: every idea a
     * star as bright as you know it, places named, one idea open in the rail
     * with its nearest six, the two lists below it, and ideas still waiting
     * for a place. Fixtures in idea-space-surfaces.tsx. */
    id: 'learn-idea-space',
    label: 'Learn · Idea Space, an idea open',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceSurface />,
  },
  {
    /* The same sky on its main axes with no place named yet, so the
     * domains are named instead, and one domain picked out in the legend. */
    id: 'learn-idea-space-domains',
    label: 'Learn · Idea Space, by domain',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceDomainsSurface />,
  },
  {
    /* The card a pointer shows over a star (plan #1997.6), held open: its
     * state, evidence, strength, when it was last shown and when it next halves. */
    id: 'learn-idea-space-card',
    label: 'Learn · Idea Space, pointing at a star',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceCardSurface />,
  },
  {
    /* The timeline under the map moved back seven weeks (plan #1997.8): ideas
     * written since are left off, and the rest are lit as they were that day,
     * with the counts for the day above the timeline. */
    id: 'learn-idea-space-replay',
    label: 'Learn · Idea Space, replaying an earlier day',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceReplaySurface />,
  },
  {
    /* One place opened as a graph (plan #1997.7), with one idea pointed at
     * so its links show their scores, and the ideas next door round the edge. */
    id: 'learn-idea-space-place',
    label: 'Learn · Idea Space, a place opened',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpacePlaceSurface />,
  },
  {
    /* An idea in no place opened as its neighbourhood (plan #1997.7). */
    id: 'learn-idea-space-around',
    label: 'Learn · Idea Space, an idea in no place opened',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceAroundSurface />,
  },
  {
    /* The moment An idea lights up (plan #1997.10): three ideas set in the
     * last two days brighten from dark to their strength when the map opens.
     * The button opens it again, which the recorder presses. */
    id: 'learn-idea-space-lights',
    label: 'Learn · Idea Space, an idea lighting up',
    module: 'learn',
    width: 'page',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="lights-up"]',
      shows:
        'The map opens again with three stars dark, and after a beat they brighten together to the strength each is known at, while every other star and the camera hold still.',
    },
    render: () => <IdeaSpaceLightsSurface />,
  },
  {
    /* Recording mode on (plan #1997.9), a place open as a graph: the hidden
     * places and the ideas in them read "A private place" and "Private idea". */
    id: 'learn-idea-space-recording',
    label: 'Learn · Idea Space, recording mode on',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceRecordingSurface />,
  },
  {
    /* Recording mode off, two places ticked to hide, in the rail's card. */
    id: 'learn-idea-space-recording-choose',
    label: 'Learn · Idea Space, choosing places to hide',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceRecordingChooseSurface />,
  },
  {
    /* Ten thousand test ideas, for the frame rate the sky has to hold (plan #1997.6). */
    id: 'learn-idea-space-dense',
    label: 'Learn · Idea Space, ten thousand ideas',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceDenseSurface />,
  },
  {
    /* Evidence lighting the map (plan #2006.6): ideas backed by a note, a
     * course or your work glow up to the ceiling, and one of them, never
     * tested, is open in the rail and pointed at, so both cards say what
     * backs it. */
    id: 'learn-idea-space-evidence',
    label: 'Learn · Idea Space, an idea your notes back',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceEvidenceSurface />,
  },
  {
    /* Wikipedia's topics as the frame (plan #2016.5), flown into Economics:
     * its Level 4 topics drawn and seven of them named, strongest first,
     * with the rest counted under the Level 3 name. */
    id: 'learn-idea-space-topics',
    label: 'Learn · Idea Space, inside a topic',
    module: 'learn',
    width: 'page',
    render: () => <IdeaSpaceTopicsSurface />,
  },
  {
    /* Clips before any are cut. */
    id: 'learn-clips-empty',
    label: 'Learn · Clips, none cut yet',
    module: 'learn',
    width: 'page',
    render: () => <ClipsEmptySurface />,
  },
  {
    /* Dev's Inspiration tab (plan #1412), by video: a point two videos made,
     * one already in the plan, a video with no transcript, and the dismissed
     * fold. Fixtures in inspiration-surfaces.tsx. */
    id: 'dev-inspiration',
    label: 'Dev · Inspiration, by video',
    module: 'dev',
    width: 'page',
    render: () => <InspirationByVideoSurface />,
  },
  {
    /* The same takeaways as one list, each naming every video it came from. */
    id: 'dev-inspiration-list',
    label: 'Dev · Inspiration, one list',
    module: 'dev',
    width: 'page',
    render: () => <InspirationListSurface />,
  },
  {
    /* Before the playlist has been read. */
    id: 'dev-inspiration-unread',
    label: 'Dev · Inspiration, not read yet',
    module: 'dev',
    width: 'page',
    render: () => <InspirationUnreadSurface />,
  },
  {
    /* Dev's Posts tab (plan #1419): two drafts waiting, one a thread with a
     * post past 280, then the posted and dropped folds. Fixtures in
     * posts-surfaces.tsx. */
    id: 'dev-posts',
    label: 'Dev · Posts',
    module: 'dev',
    width: 'page',
    render: () => <PostsSurface />,
  },
  {
    /* What I want from posts (plan #2227.2), saved: the line under the
     * heading holds the text on one line and the day it was saved. With
     * nothing saved it is the one-line prompt dev-posts draws. */
    id: 'dev-posts-wants',
    label: 'Dev · Posts, what you want from them',
    module: 'dev',
    width: 'page',
    render: () => <PostsWantsSurface />,
  },
  {
    /* The wants line pressed: the box open on the saved text. */
    id: 'dev-posts-wants-edit',
    label: 'Dev · Posts, changing what you want',
    module: 'dev',
    width: 'page',
    render: () => <PostsWantsEditSurface />,
  },
  {
    /* Save pressed on the wants box: mid-save, then refused. */
    id: 'dev-posts-wants-saving',
    label: 'Dev · Posts, saving what you want',
    module: 'dev',
    width: 'page',
    render: () => <PostsWantsSavingSurface />,
  },
  {
    /* The first press: Dash drafting, nothing written yet. */
    id: 'dev-posts-drafting',
    label: 'Dev · Posts, while Dash drafts',
    module: 'dev',
    width: 'page',
    render: () => <PostsDraftingSurface />,
  },
  {
    /* A run that wrote no draft, with the note it left saying why. */
    id: 'dev-posts-no-draft',
    label: 'Dev · Posts, when Dash wrote no draft',
    module: 'dev',
    width: 'page',
    render: () => <PostsNoDraftSurface />,
  },
  {
    /* Write your own, opened: a post the person writes joins the drafts. */
    id: 'dev-posts-write',
    label: 'Dev · Posts, writing your own',
    module: 'dev',
    width: 'page',
    render: () => <PostsWriteSurface />,
  },
  {
    /* The X connection (plan #1818) in each state it can be in: keys not
     * set, not connected, X stopped accepting the sign-in, connected with
     * the longest handle X allows, and the lines a failed round trip leaves. */
    id: 'dev-posts-x',
    label: 'Dev · Posts, the X connection',
    module: 'dev',
    width: 'page',
    render: () => <PostsXSurface />,
  },
  {
    /* The tab once X has been read (plan #1820): a draft asking "Is this
     * it?" about a post that reads close to it, one the match marked posted,
     * and Posted on X, the posts that match no draft, opened. */
    id: 'dev-posts-matched',
    label: 'Dev · Posts, matched to X',
    module: 'dev',
    width: 'page',
    render: () => <PostsMatchedSurface />,
  },
  {
    /* Post pressed once (plan #2072): the confirm on a draft with a link,
     * warning about X's URL rate, and on a thread whose first post is
     * already up, sending the rest. */
    id: 'dev-posts-send',
    label: 'Dev · Posts, posting to X',
    module: 'dev',
    width: 'page',
    render: () => <PostsSendSurface />,
  },
  {
    /* Comments on a draft (plan #2202.2): a waiting draft Dash shortened
     * when tagged, with an untagged note under it, and a posted one whose
     * tagged comment Dash marked seen. */
    id: 'dev-posts-thread',
    label: 'Dev · Posts, comments on a draft',
    module: 'dev',
    width: 'page',
    render: () => <PostsThreadSurface />,
  },
  {
    /* Add a comment pressed on a draft with no thread: the box open. */
    id: 'dev-posts-comment',
    label: 'Dev · Posts, writing a comment',
    module: 'dev',
    width: 'page',
    render: () => <PostsCommentSurface />,
  },
  {
    /* Home's Inbox (plan #1937.7), which took the bell's place: every
     * workspace's on-you rows, grouped under each workspace's mark. Fixtures
     * in home-inbox-surfaces.tsx. */
    id: 'home-inbox',
    label: 'Home · Inbox',
    module: 'goals',
    width: 'page',
    render: () => <HomeInboxSurface />,
  },
  {
    /* Home as a whole page on the main-plus-rail pattern (plan #1627): the
     * header, briefs, Today and Updates in the main column, and Watching,
     * what Dash did, the week and the workspaces in the rail. Inside the
     * shell, so the widths are the ones the page gets. Fixtures in
     * home-page-surfaces.tsx. */
    id: 'home-page',
    label: 'Home · The whole page',
    module: 'goals',
    width: 'page',
    render: () => <HomePageSurface />,
  },
  {
    /* The home page's Watching section (plan #1295): a watch that fired, one
     * reporting only, and one whose page stopped reading. Fixtures in
     * watching-surfaces.tsx. */
    id: 'home-watching',
    label: 'Home · What Dash is watching',
    module: 'goals',
    width: 'wide',
    render: () => <WatchingSurface />,
  },
  {
    /* Home's list of what Dash did today (plan #1461), with a thread's
     * change linked back to the role whose comment asked for it (plan
     * #1518). Fixtures in dash-today-surfaces.tsx. */
    id: 'home-dash-today',
    label: 'Home · What Dash did today',
    module: 'goals',
    width: 'wide',
    render: () => <DashTodaySurface />,
  },
  {
    /* A workspace's Now carries the same fold, filtered to that workspace
     * (plan #1964.4). Fixtures in dash-today-surfaces.tsx. */
    id: 'now-dash-today',
    label: 'Workspace Now · What Dash did today',
    module: 'todo',
    width: 'wide',
    render: () => <NowDashTodaySurface />,
  },
  {
    /* The "What did you do?" box (plan #1740): Home's Done today with a line
     * filed as three changes and the day's list, the same card with nothing
     * done yet, and the box on a goal's Overview. Fixtures in
     * log-done-surfaces.tsx. */
    id: 'goals-log-done',
    label: 'Home and goals · What did you do?',
    module: 'goals',
    width: 'wide',
    render: () => <LogDoneSurface />,
  },
  {
    /* A goal's Suggestions section (plan #1739): suggested steps with Add as
     * step, an event with Going, one marked going and the help asked for,
     * then a goal with nothing suggested yet. Fixtures in
     * goal-suggestions-surfaces.tsx. */
    id: 'goals-suggestions',
    label: 'Goal · Suggestions',
    module: 'goals',
    width: 'page',
    render: () => <GoalSuggestionsSurface />,
  },
  {
    /* A goal's metrics in its properties column (plan #2084.3): two metrics,
     * one with the longest name, and the line that adds another. The column
     * is drawn as a phone's opened fold and the laptop's rail. Fixtures in
     * goal-metric-props-surfaces.tsx, as are the parts below. */
    id: 'goals-metrics-props',
    label: 'Goal · Metrics in the properties',
    module: 'goals',
    width: 'narrow',
    render: () => <GoalMetricPropsSurface />,
  },
  {
    /* The add line pressed: the form open in place. */
    id: 'goals-metrics-props-form',
    label: 'Goal · Metrics, adding one',
    module: 'goals',
    width: 'narrow',
    render: () => <GoalMetricPropsFormSurface />,
  },
  {
    /* A metric's row pointed at, its Change and Remove menu showing. */
    id: 'goals-metrics-props-menu',
    label: 'Goal · Metrics, a row’s menu',
    module: 'goals',
    width: 'narrow',
    render: () => <GoalMetricPropsMenuSurface />,
  },
  {
    /* No list on the goal has a date to count by. */
    id: 'goals-metrics-props-empty',
    label: 'Goal · Metrics, nothing to count',
    module: 'goals',
    width: 'narrow',
    render: () => <GoalMetricPropsEmptySurface />,
  },
  {
    /* A new metric mid-save: the button's pending state. */
    id: 'goals-metrics-props-pending',
    label: 'Goal · Metrics, saving',
    module: 'goals',
    width: 'narrow',
    render: () => <GoalMetricPropsPendingSurface />,
  },
  {
    /* A change refused, its message beside the field. */
    id: 'goals-metrics-props-error',
    label: 'Goal · Metrics, a change refused',
    module: 'goals',
    width: 'narrow',
    render: () => <GoalMetricPropsErrorSurface />,
  },
  {
    /* The timeline (plan #1118): the months newest first, the newest open,
     * each with its count per kind on the line that folds it. Fixtures in
     * timeline-surfaces.tsx. */
    id: 'timeline-page',
    label: 'Timeline · What you did, month by month',
    module: 'goals',
    width: 'page',
    render: () => <TimelineSurface />,
  },
  {
    /* The year in review (plan #1121): what Dash wrote, each paragraph with
     * its rows, then every number the paragraphs may use. Fixtures in
     * timeline-surfaces.tsx. */
    id: 'timeline-year',
    label: 'Timeline · The year in review',
    module: 'goals',
    width: 'page',
    render: () => <YearReviewSurface />,
  },

  {
    /* The whole shell, which no other surface shows: the sidebar, the top bar,
     * and a real page inside them. Every other entry here is a panel on the
     * page's ground, so the chrome -- where most of the app's character
     * actually lives -- had never been photographed at all.
     *
     * The props are the ones app/jobs/(app)/layout.tsx passes, copied rather
     * than imported because that layout reads a session and a database and
     * this route reads neither. */
    id: 'shell-full',
    label: 'The shell · Sidebar, top bar and a page',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AppShell
        account="preview"
        module="jobs"
        sections={shellSections}
        settingsHref="/jobs/settings"
        settingsLabel="Job search settings"
        displayName="Chris"
        email="chris@example.com"
        // The picture is of the owner's shell, which is the one with every
        // workspace in the switcher.
        isOwner
        counts={{ jobs: '12', shopping: '3', todo: '8' }}
        theme={{ kind: 'written', id: 'paper' }}
        brief={null}
      >
        <TodayLists board={todayBoard} timezone="Europe/London" />
      </AppShell>
    ),
  },

  {
    /* The status line while Dash is on a run (plan #1964.2.3): its mark, working,
     * and the run's newest line in the run's own words, linking to the run. The
     * line is drawn from lg up only, as everywhere, so the phone shots are the
     * page without it by design. The longest line a run writes, beside the
     * workspace summary and the main dot, is the fixture. */
    id: 'shell-status-run',
    label: 'The shell · Status line while Dash is on a run',
    module: 'jobs',
    width: 'page',
    render: () => (
      <StatusRunSurface
        going={{
          href: '/goals/runs/6b1f0c52-3d1e-4c7a-9a40-2f6d8e1b7c03',
          line: {
            id: 'line-1',
            user_id: 'u',
            run_table: 'goals.runs',
            run_id: '6b1f0c52-3d1e-4c7a-9a40-2f6d8e1b7c03',
            kind: 'action',
            body: 'Reading the three most recent statements from Gmail to fill in what the mortgage step still needs before the end of the month',
            options: null,
            created_at: '2026-10-15T10:00:00Z',
          },
        }}
      />
    ),
  },
  {
    id: 'shell-status-run-new',
    label: 'The shell · Status line, run started and no line written yet',
    module: 'jobs',
    width: 'page',
    render: () => <StatusRunSurface going={{ href: '/dev/plan/runs/6b1f0c52-3d1e-4c7a-9a40-2f6d8e1b7c03', line: null }} />,
  },

  {
    /* The You workspace in its shell, on Personality, its first tab (plan
     * #1991.1): the four tabs in the sidebar and, since #1991.2, the tab
     * with a result taken and read. */
    id: 'you-shell',
    label: 'You · The workspace on its first tab',
    module: 'you',
    width: 'page',
    render: () => (
      <AppShell
        account="preview"
        module="you"
        sections={youSections}
        displayName="Chris"
        email="chris@example.com"
        isOwner
        counts={{ jobs: '12', shopping: '3', todo: '8' }}
        theme={{ kind: 'written', id: 'paper' }}
        brief={null}
      >
        <YouPersonalitySurface />
      </AppShell>
    ),
  },
  {
    id: 'you-insights',
    label: 'You · Insights, before Dash has noticed anything',
    module: 'you',
    width: 'page',
    render: () => <YouTabEmpty tab="insights" />,
  },
  {
    /* Details (plan #2124.2): the six facts a form asks for, read as a
     * list, LinkedIn as a link, with the count in the rail. */
    id: 'you-details',
    label: 'You · Details, all six set',
    module: 'you',
    width: 'page',
    render: () => <DetailsView details={youDetails} />,
  },
  {
    id: 'you-details-empty',
    label: 'You · Details, before any are given',
    module: 'you',
    width: 'page',
    render: () => <DetailsView details={EMPTY_DETAILS} />,
  },
  {
    /* Edit details turns the list into its six fields in place. Two not set. */
    id: 'you-details-edit',
    label: 'You · Details, being edited',
    module: 'you',
    width: 'page',
    render: () => <DetailsView details={{ ...youDetails, race: null, sexuality: null }} editing />,
  },
  {
    /* A save that did not go through keeps what was typed and says why. */
    id: 'you-details-error',
    label: 'You · Details, a save that did not go through',
    module: 'you',
    width: 'page',
    render: () => (
      <DetailsView
        details={youDetails}
        editing
        state={{
          error: 'The connection dropped before your details saved. What you typed is still here: press Save to try again.',
          values: {
            phone: '+353 87 555 0199',
            linkedin_url: 'linkedin.com/in/christopher-alexander-montgomery-whitfield',
            citizenship: 'United States and Ireland',
            race: 'White',
            gender: 'Man',
            sexuality: '',
          },
        }}
      />
    ),
  },
  {
    /* Places they have lived, newest first, the home they live in now marked (plan #1991.5). */
    id: 'you-places',
    label: 'You · Places, four homes',
    module: 'you',
    width: 'page',
    render: () => <PlacesView places={youPlaces} />,
  },
  {
    /* The Map view (plan #2091.4): three homes on the map, two of them in
     * neighbouring cities fanned apart, joined in move-in order, the home
     * they live in now marked, and one with no position listed beneath. */
    id: 'you-places-map',
    label: 'You · Places on the map',
    module: 'you',
    width: 'page',
    render: () => <PlacesView places={youPlacesOnMap} view="map" map={drawPlacesMap(youPlacesOnMap)} />,
  },
  {
    /* Hovering a dot names the place and its years. */
    id: 'you-places-map-tooltip',
    label: 'You · Places on the map, a dot hovered',
    module: 'you',
    width: 'page',
    render: () => (
      <PlacesView places={youPlacesOnMap} view="map" map={drawPlacesMap(youPlacesOnMap)} tipOpenFor="place-lisbon" />
    ),
  },
  {
    /* The Map view before any place has a position. */
    id: 'you-places-map-empty',
    label: 'You · Places on the map, before any has a position',
    module: 'you',
    width: 'page',
    render: () => <PlacesView places={youPlaces} view="map" map={drawPlacesMap(youPlaces)} />,
  },
  {
    id: 'you-places-empty',
    label: 'You · Places, before any are added',
    module: 'you',
    width: 'page',
    render: () => <PlacesView places={[]} />,
  },
  {
    /* What Add a place opens (plan #1950.7): capture aimed at a place, a
     * home typed with its dates, and one refused for having none. */
    id: 'you-places-add',
    label: 'You · Add a place, through capture',
    module: 'you',
    width: 'narrow',
    render: () => <AimedPlaceSurface />,
  },
  {
    id: 'you-place',
    label: 'You · One place, the home they live in now',
    module: 'you',
    width: 'page',
    render: () => (
      <PlaceView place={youPlaces[0]} thisMonth="2026-10" map={drawPlaceMap(youPlaces[0], youPlaces)} />
    ),
  },
  {
    /* A place on the map (plan #2091.5): its region, its dot, Move and Clear. */
    id: 'you-place-map',
    label: 'You · One place, on the map',
    module: 'you',
    width: 'page',
    render: () => (
      <PlaceView
        place={youPlacesOnMap[0]}
        thisMonth="2026-10"
        map={drawPlaceMap(youPlacesOnMap[0], youPlacesOnMap)}
      />
    ),
  },
  {
    /* Set on map pressed for a place with no position: the hint line, the
     * map of the region their other places are in, and Cancel. */
    id: 'you-place-map-placing',
    label: 'You · One place, being set on the map',
    module: 'you',
    width: 'page',
    render: () => (
      <PlaceView
        place={youPlacesOnMap[3]}
        thisMonth="2026-10"
        map={{ ...drawPlaceMap(youPlacesOnMap[3], youPlacesOnMap), start: { placing: true } }}
      />
    ),
  },
  {
    /* The same, after a press whose save did not go through. */
    id: 'you-place-map-error',
    label: 'You · One place, a position that did not save',
    module: 'you',
    width: 'page',
    render: () => (
      <PlaceView
        place={youPlacesOnMap[3]}
        thisMonth="2026-10"
        map={{
          ...drawPlaceMap(youPlacesOnMap[3], youPlacesOnMap),
          start: { placing: true, error: 'The place was not put on the map. Try again.' },
        }}
      />
    ),
  },
  {
    id: 'you-place-form',
    label: 'You · Changing a place',
    module: 'you',
    width: 'page',
    render: () => <PlaceForm place={youPlaces[1]} />,
  },

  {
    id: 'news-issue-digest',
    label: 'News · Issue summary and stories',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueBase} />,
  },
  {
    id: 'news-issue-digest-no-pictures',
    label: 'News · Issue summary with pictures off',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueBase} pictures={false} picturesHref="/news/i/issue-1" />,
  },
  {
    id: 'news-issue-essay',
    label: 'News · Single-essay issue summary',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueEssay} />,
  },
  {
    id: 'news-issue-original',
    label: 'News · Issue original email',
    module: 'news',
    width: 'page',
    render: () => (
      <IssueView
        {...issueBase}
        showDigest={false}
        html={issueFailed.html}
        pictures={false}
        blockedImages={1}
      />
    ),
  },
  {
    id: 'news-issue-confirm',
    label: 'News · Signup email waiting to be confirmed',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueSignup} />,
  },
  {
    id: 'news-issue-confirmed',
    label: 'News · Signup email confirmed',
    module: 'news',
    width: 'page',
    render: () => (
      <IssueView
        {...issueSignup}
        confirm={{
          url: issueSignup.confirm?.url ?? '',
          confirmedLabel: 'Sat 10 Oct, 9:41 AM',
        }}
      />
    ),
  },
  {
    id: 'news-issue-failed',
    label: 'News · Issue whose summary failed',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueFailed} />,
  },
  {
    id: 'news-quick-story',
    label: 'News · Quick read story card',
    module: 'news',
    width: 'page',
    interaction: {
      kind: 'swipe',
      target: '[data-quick-swipe]',
      direction: 'left',
      shows: 'The card follows the finger left, then springs off as the essay behind it comes in.',
    },
    deck: { next: '#quick-read-next button[type="submit"]', item: '[data-quick-swipe]' },
    // The essay drawn behind it, so Next shows it at once (note 452a90d9).
    // Under the room AppShell's main keeps for the tab bar, so the foot of
    // the card scrolls clear of the Next row as it does in the app.
    render: () => (
      <div className={SHELL_FOOT}>
        <QuickReadView
          {...quickStory}
          upNext={{
            card: quickEssay.card!,
            arrived: '20 Sep, 9:02\u00a0AM',
            saved: false,
            issueHref: '/news/i/issue-2',
          }}
        />
      </div>
    ),
  },
  {
    /* The same card inside the News shell (plan #1446), so a phone shot shows
     * the top bar, the dock, and Back and Next held just above the dock. The
     * entry above has no shell, so its row sits over nothing. */
    id: 'news-quick-in-shell',
    label: 'News · Quick read inside the shell',
    module: 'news',
    width: 'page',
    render: () => (
      <div data-workspace="news">
        <AppShell
          account="preview"
          module="news"
          sections={[
            { href: '/news', label: 'Now', icon: 'quickRead', exact: true },
            { href: '/news/inbox', label: 'Inbox', icon: 'inbox', exact: true },
            { href: '/news/review', label: 'Daily review', icon: 'dailyReview', exact: true },
            { href: '/news/all', label: 'Newsletters', icon: 'newsletters', exact: true },
            { href: '/news/saved', label: 'Saved', icon: 'saved', exact: true },
          ]}
          settingsHref="/news/settings"
          settingsLabel="News settings"
          displayName="Chris"
          email="chris@example.com"
          isOwner
          counts={{ jobs: '12', shopping: '3', todo: '8' }}
          theme={{ kind: 'written', id: 'paper' }}
          brief={null}
        >
          <QuickReadView {...quickStory} />
        </AppShell>
      </div>
    ),
  },
  {
    id: 'news-quick-essay',
    label: 'News · Quick read single-essay card',
    module: 'news',
    width: 'page',
    render: () => (
      <div className={SHELL_FOOT}>
        <QuickReadView {...quickEssay} />
      </div>
    ),
  },
  {
    id: 'news-quick-page',
    label: 'News · Quick read page on a laptop',
    module: 'news',
    width: 'page',
    render: () => (
      <div className={SHELL_FOOT}>
        <QuickReadView {...quickPageView} />
      </div>
    ),
  },
  {
    id: 'news-quick-page-full',
    label: 'News · A full Quick read page, every story with a picture',
    module: 'news',
    width: 'page',
    render: () => (
      <div className={SHELL_FOOT}>
        <QuickReadView {...quickFullPage} />
      </div>
    ),
  },
  {
    id: 'news-quick-caught-up',
    label: 'News · Quick read caught up',
    module: 'news',
    width: 'page',
    render: () => <QuickReadView {...quickStory} card={null} arrived={null} issueHref={null} />,
  },
  {
    id: 'news-story-grid',
    label: 'News · Story grid with pictures',
    module: 'news',
    width: 'page',
    render: () => <StoryGrid stories={gridStories} pictures />,
  },
  {
    id: 'news-story-grid-no-pictures',
    label: 'News · Story grid with no pictures',
    module: 'news',
    width: 'page',
    render: () => (
      <StoryGrid stories={gridStories.map((story) => ({ ...story, image: null }))} pictures />
    ),
  },
  {
    /* Shopping's Recurring page (plan #1126): the monthly figure, what is
     * coming up with a price rise marked, and what stopped charging. */
    id: 'shopping-recurring',
    label: 'Shopping · Recurring payments',
    module: 'shopping',
    width: 'page',
    render: () => <RecurringSurface />,
  },
  {
    id: 'shopping-recurring-empty',
    label: 'Shopping · Recurring with nothing found',
    module: 'shopping',
    width: 'page',
    render: () => <RecurringEmptySurface />,
  },
  {
    id: 'news-needs-confirming',
    label: 'News · Newsletters waiting to be confirmed',
    module: 'news',
    width: 'page',
    render: () => <NeedsConfirmingSurface />,
  },
  {
    id: 'news-saved',
    label: 'News · Saved stories',
    module: 'news',
    width: 'page',
    render: () => <SavedView {...savedStories} />,
  },
  {
    id: 'news-review',
    label: 'News · Daily review',
    module: 'news',
    width: 'page',
    render: () => <ReviewView {...reviewFull} />,
  },
  {
    id: 'news-review-empty',
    label: 'News · Daily review before the first one',
    module: 'news',
    width: 'page',
    render: () => <ReviewView review={null} earlier={null} later={null} todayAt={'8:00\u00a0PM'} />,
  },
  {
    /* Tonight's run failed and is tried again on the hour until midnight;
     * earlier days are still there behind the back arrow. */
    id: 'news-review-failed',
    label: 'News · Daily review that could not be written',
    module: 'news',
    width: 'page',
    render: () => (
      <ReviewView
        review={{ dayLabel: 'Tuesday 6 October', writtenAt: '9:00\u00a0PM', overview: null, lines: [], retrying: true }}
        earlier={{ href: '/news/review?day=2026-10-05', label: 'Mon 5 Oct' }}
        later={null}
        todayAt={null}
      />
    ),
  },
  {
    id: 'news-saved-empty',
    label: 'News · Saved with nothing saved',
    module: 'news',
    width: 'page',
    render: () => <SavedView stories={[]} />,
  },

  {
    /* The $ hint beside three paid buttons: one with enough runs to give a
     * range, one that is a guess, and one priced per item and multiplied by
     * the batch. Each starts open so the shot shows the figure as well as the
     * mark; in the app it opens on hover, focus or a press. The rows are
     * spaced for the popup that hangs below each. */
    id: 'core-cost-hint',
    label: 'Spend · The $ hint beside a paid button',
    module: 'learn',
    width: 'narrow',
    render: () => <CostHintRows />,
  },
  {
    /* The shared Tooltip on an icon button, a badge with a long tip and an
     * icon at a row's right edge. Each starts showing so the shot has the tip
     * as well as its child; in the app it shows on hover or keyboard focus
     * after a short delay and hides on blur, Escape or pointer leave. */
    id: 'core-tooltip',
    label: 'Tooltip · on an icon and a badge',
    module: 'learn',
    width: 'narrow',
    render: () => <TooltipRows />,
  },
  {
    /* Later, the one menu for putting a thing off (plan #1957.2): the word
     * and the clock that open it, the menu open with its five days, and the
     * field Pick a day opens. */
    id: 'core-later-menu',
    label: 'Later · the menu every put-off opens',
    module: 'todo',
    width: 'narrow',
    render: () => <LaterMenuRows />,
  },
  {
    /* The four words that close a row (plan #1957.3): Done, Drop, Later and
     * Decline with their glyphs, as buttons, as icons and as menu entries,
     * and the toast each leaves with Undo. */
    id: 'core-close-buttons',
    label: 'Closing · the four words, their glyphs and Undo',
    module: 'todo',
    width: 'narrow',
    render: () => <CloseButtonRows />,
  },
  {
    /* /account/spend: every operation's estimate beside its thirty-day median.
     * At phone width the rows stack into label/value pairs. */
    id: 'core-spend-estimates',
    label: 'Spend · Estimates against actual spend',
    module: 'learn',
    width: 'page',
    render: () => <SpendEstimates />,
  },

  /* The three shared motion pieces (plan #1550), each on the /dev/ui demo
   * that shows it, so a recording keeps the strip of it playing. */
  {
    id: 'dev-motion-travel',
    label: 'Motion · Travel, a chip flying to its place',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="travel"]',
      shows: 'A chip carrying the first words leaves "capture", crosses, and fades as it lands on "todo".',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <TravelDemo />
      </div>
    ),
  },
  {
    id: 'dev-motion-settle',
    label: 'Motion · Settle, a row springing into place',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="settle"]',
      shows: 'A second row rises into the list with a little give, and "todo" swells once with "Todo · Today" beside it.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <SettleDemo />
      </div>
    ),
  },
  {
    id: 'dev-motion-clear',
    label: 'Motion · Clear, the last item leaving',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="clear"]',
      shows: 'The last item leaves with a puff and the day\'s sigil draws in cell by cell in its place.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <ClearDemo items={['Return the kettle']} />
      </div>
    ),
  },

  /* Dash's mark in every state, and the runner card's four Dashes, each in
   * its own visor and colour: every state at 44 and 24 pixels. */
  {
    id: 'dash-mark',
    label: 'Dash · Dash and the runner’s four Dashes',
    module: 'dev',
    width: 'narrow',
    render: () => <DashMarkRunners />,
  },

  /* Every shared component in components/ui, in each state it has. A change
   * to a primitive is looked at here instead of on every page that imports
   * it (COMPONENT_SURFACES in lib/preview/routes.ts). */
  {
    id: 'ui-kit',
    label: 'Design · Every shared component',
    module: 'dev',
    width: 'wide',
    render: () => <UiKit />,
  },

  /* A ref link's preview held open (plan #1931.4): the hidden part of every
   * comment, Dash reply and plan detail that names a row. */
  {
    id: 'ref-preview',
    label: 'Design · A ref link previewing its row',
    module: 'dev',
    width: 'narrow',
    render: () => <RefPreviewSurface />,
  },

  /* The per-day bar chart for the usage pages (plan #2036.1): a month of
   * page views, a month of spend with one busy day, a month with one day of
   * activity and a month with none. Its two hidden parts follow: the readout
   * held on a day, as pointing or tapping shows it, and the empty period. */
  {
    id: 'usage-day-bars',
    label: 'Usage · Per-day bar chart',
    module: 'dev',
    width: 'wide',
    render: () => <DayBarsSurface />,
  },
  {
    id: 'usage-day-bars-readout',
    label: 'Usage · Per-day bar chart, pointing at a day',
    module: 'dev',
    width: 'wide',
    interaction: {
      kind: 'press',
      target: '[data-day-bars]',
      shows: 'Tapping the chart lights the bar under the finger, dims the rest, and names its day and value under the chart.',
    },
    render: () => <DayBarsReadoutSurface />,
  },
  {
    id: 'account-spend-overview',
    label: 'Account · Spend, chart above the totals',
    module: 'learn',
    width: 'page',
    render: () => <SpendOverviewSurface />,
  },
  {
    id: 'account-spend-by-module',
    label: 'Account · Spend, where it goes, one fold per module',
    module: 'learn',
    width: 'page',
    render: () => <SpendByModuleSurface />,
  },
  {
    id: 'account-spend-by-module-open',
    label: 'Account · Spend, where it goes, a module opened',
    module: 'learn',
    width: 'page',
    render: () => <SpendByModuleSurface open="jobs" />,
  },
  {
    id: 'usage-day-bars-empty',
    label: 'Usage · Per-day bar chart, nothing in the period',
    module: 'dev',
    width: 'wide',
    render: () => <DayBarsEmptySurface />,
  },

  /* The day closing on the agenda (plan #1556): played by ticking the last
   * thing due today, and as a page that loads with the day already closed. */
  {
    id: 'todo-day-close',
    label: 'Todo · The day closing',
    module: 'todo',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="day-close"]',
      shows:
        'The two done tasks spring from their rows into a pile that folds shut, the day\'s sigil draws in beside it, and "You finished all 2 things due today." arrives last.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <DayCloseDemo
          due={['Return the kettle', 'Book the dentist']}
          alreadyDone={['Return the kettle']}
        />
      </div>
    ),
  },
  {
    /* Rows the agenda borrows from other workspaces (plan #1957.9): one that
     * can be ticked, one that is a date and cannot, each with the one Later
     * menu as its clock and Drop beside it. */
    id: 'todo-agenda-rows',
    label: 'Todo · Agenda rows from elsewhere',
    module: 'todo',
    width: 'narrow',
    render: () => <AgendaRowsSurface />,
  },
  {
    /* The agenda opens with a button, not a box (plan #1950.6). */
    id: 'todo-agenda-header',
    label: 'Todo · Add a todo',
    module: 'todo',
    width: 'narrow',
    render: () => (
      <PageHeader
        title="Agenda"
        actions={<AimButton aim={{ kind: 'todo' }} label="Add a todo" />}
      />
    ),
  },
  {
    id: 'todo-day-closed',
    label: 'Todo · A day already closed',
    module: 'todo',
    width: 'narrow',
    render: () => (
      <DayClosed
        closed
        seed="preview:day-closed"
        done={[
          { id: 'a', title: 'Renew the parking permit' },
          { id: 'b', title: 'Book the dentist' },
          { id: 'c', title: 'Return the kettle' },
          { id: 'd', title: 'Pay the window cleaner' },
        ]}
      />
    ),
  },

  /* Todos holding files (plan #1714): the paperclip and count on the row,
   * and the files it opens under the row. */
  {
    id: 'todo-task-files',
    label: 'Todo · A task with files',
    module: 'todo',
    width: 'narrow',
    render: () => <TaskFilesSurface />,
  },

  /* The end of Quick read (plan #1557): played by passing the last story,
   * and as a page that loads already caught up. */
  {
    id: 'news-quick-got-through',
    label: 'News · The end of Quick read',
    module: 'news',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="got-through"]',
      shows:
        'The last story goes, the day\'s sigil draws in, and the card below lifts in with Read counting up to 9 and Skipped to 4, the longest-read story and the two newsletters due next.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <GotThroughDemo stories={['Rail strike called off']} />
      </div>
    ),
  },
  {
    id: 'news-quick-got-through-loaded',
    label: 'News · Quick read already finished',
    module: 'news',
    width: 'narrow',
    render: () => (
      <GotThrough
        done
        summary={{
          read: 14,
          skipped: 6,
          longest: { headline: 'Why the rail strike was called off at midnight', held: '4 minutes' },
          due: [{ from: 'The Morning Letter', when: 'tomorrow around 6:00\u00a0AM' }],
        }}
      />
    ),
  },

  /* Home's first visit of the day and a finished day (plan #1558): played
   * from the gallery demo, and at rest with the day already finished. */
  {
    id: 'home-arrival',
    label: 'Home · The first visit of the day',
    module: 'dev',
    width: 'page',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="home-arrival"]',
      shows:
        'The greeting, the date, the panel with the brief line, each rise in a beat after the one before, the brief rows, the Inbox count and the rail together on the last, all settled by about three quarters of a second.',
    },
    render: () => <HomeArrivalDemo />,
  },
  {
    id: 'home-finished-day',
    label: 'Home · A finished day',
    module: 'dev',
    width: 'page',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="home-finished"]',
      shows: "Today leaves the rail, and the day's sigil draws in cell by cell beside the date.",
    },
    render: () => <HomeArrivalDemo />,
  },
  {
    id: 'home-finished-day-rest',
    label: 'Home · A day already finished',
    module: 'dev',
    width: 'page',
    render: () => <HomeArrivalDemo finished />,
  },

  /* The pages outside the shell, and /open's not-found (plan #1599).
   * Fixtures in public-surfaces.tsx. */
  {
    id: 'front-door',
    label: 'Front door · The public homepage',
    module: 'dev',
    width: 'screen',
    render: () => <FrontDoorSurface />,
  },
  {
    id: 'auth-login',
    label: 'Sign in · After Google sign-in failed',
    module: 'dev',
    width: 'screen',
    render: () => <LoginSurface />,
  },
  {
    id: 'auth-signup',
    label: 'Sign up',
    module: 'dev',
    width: 'screen',
    render: () => <SignupSurface />,
  },
  {
    id: 'auth-reset-password',
    label: 'Sign in · Reset your password',
    module: 'dev',
    width: 'screen',
    render: () => <ResetPasswordSurface />,
  },
  {
    id: 'auth-code-error',
    label: 'Sign in · A link that did not work',
    module: 'dev',
    width: 'screen',
    render: () => <AuthCodeErrorSurface />,
  },
  {
    id: 'auth-consent',
    label: 'Sign in · An app asking to connect',
    module: 'dev',
    width: 'screen',
    render: () => <ConsentSurface />,
  },
  {
    id: 'legal-privacy',
    label: 'Privacy policy',
    module: 'dev',
    width: 'screen',
    render: () => <PrivacySurface />,
  },
  {
    id: 'legal-terms',
    label: 'Terms',
    module: 'dev',
    width: 'screen',
    render: () => <TermsSurface />,
  },
  {
    id: 'onboarding-welcome',
    label: 'Onboarding · Welcome',
    module: 'shopping',
    width: 'screen',
    render: () => <OnboardingWelcomeSurface />,
  },
  {
    id: 'onboarding-gmail',
    label: 'Onboarding · Gmail, after access was refused',
    module: 'shopping',
    width: 'screen',
    render: () => <OnboardingGmailSurface />,
  },
  {
    id: 'share-form',
    label: 'Shared list · Keep, sell or give away',
    module: 'shopping',
    width: 'screen',
    render: () => <ShareFormSurface />,
  },
  {
    id: 'open-missing',
    label: 'Open · A link to a row that has gone',
    module: 'dev',
    width: 'page',
    render: () => <OpenMissingSurface />,
  },
  /* A workspace's not-found and error files, inside the shell (plan #1923). */
  {
    id: 'route-not-found',
    label: 'Any workspace · A row that is no longer there',
    module: 'news',
    width: 'page',
    render: () => <RouteNotFoundSurface />,
  },
  {
    id: 'route-error',
    label: 'Any workspace · A page that failed to load',
    module: 'news',
    width: 'page',
    render: () => <RouteErrorSurface />,
  },

  /* The account, the week review and the Dev tabs (plan #1600). Fixtures
   * in dev-page-surfaces.tsx, week-surfaces.tsx and plan-surfaces.tsx. */
  {
    id: 'account',
    label: "Account · Settings across every workspace",
    module: 'dev',
    width: 'page',
    render: () => <AccountSurface />,
  },
  {
    /* The tab Dash's link opens when a watch would reach no phone (plan #1628). */
    id: 'account-notifications',
    label: 'Account · Notifications on this device',
    module: 'dev',
    width: 'page',
    render: () => <AccountSurface tab="notifications" />,
  },
  {
    /* The workspaces and the one list of settings links, with Timeline and Model spend (plan #1743). */
    id: 'account-workspaces',
    label: 'Account · Workspaces and settings links',
    module: 'dev',
    width: 'page',
    render: () => <AccountSurface tab="workspaces" />,
  },
  {
    /* Connected apps and capture tokens (plan #1705). */
    id: 'account-activity',
    label: 'Account · Activity and capture tokens',
    module: 'dev',
    width: 'page',
    render: () => <AccountSurface tab="activity" />,
  },
  {
    /* A capture token straight after it is made, shown the once (plan #1705). */
    id: 'account-capture-token-made',
    label: 'Account · A capture token just made',
    module: 'dev',
    width: 'page',
    render: () => (
      <AccountSurface
        tab="activity"
        onlyFirstToken
        justMade={{ label: 'iPhone Shortcut', token: 'dash_Zq3vN8kXo2Lr5TfWb9YcHs1PmAe7JuGd4KiVn0QxR6w' }}
      />
    ),
  },
  {
    id: 'home-week',
    label: "Home · The week in review",
    module: 'goals',
    width: 'page',
    render: () => <WeekReviewSurface />,
  },
  {
    id: 'home-week-none',
    label: "Home · The week in review, before the first",
    module: 'goals',
    width: 'page',
    render: () => <WeekReviewNoneSurface />,
  },
  {
    id: 'dev-bugs',
    label: "Dev · Bugs and requests",
    module: 'dev',
    width: 'page',
    render: () => <DevBugsSurface />,
  },
  {
    id: 'dev-changelog',
    label: "Dev · Changelog",
    module: 'dev',
    width: 'page',
    render: () => <DevChangelogSurface />,
  },
  {
    /* By day, with the after picture under each line that changed a screen
     * (plan #1541). */
    id: 'dev-changelog-screens',
    label: 'Dev · Changelog with changed screens',
    module: 'dev',
    width: 'page',
    render: () => <DevChangelogScreensSurface />,
  },
  {
    /* The status words on the plan, ideas and inbox pages, with the
     * sentence each one's Tooltip says (plan #1985.5). */
    id: 'dev-status-tips',
    label: 'Dev · Status words and their tips',
    module: 'dev',
    width: 'narrow',
    render: () => <DevStatusTips />,
  },
  {
    id: 'dev-ideas',
    label: "Dev · Ideas",
    module: 'dev',
    width: 'page',
    render: () => <DevIdeasSurface />,
  },
  {
    id: 'dev-ideas-empty',
    label: 'Dev · Ideas, nothing written down',
    module: 'dev',
    width: 'page',
    render: () => <DevIdeasEmptySurface />,
  },
  {
    id: 'dev-project-plan',
    label: "Dev · A project's plan",
    module: 'dev',
    width: 'page',
    render: () => <ProjectPlanSurface />,
  },
  {
    id: 'dev-raised',
    label: 'Dev · Home',
    module: 'dev',
    width: 'page',
    render: () => <DevRaisedSurface />,
  },
  {
    /* Everything waiting on you, moved off Home into its own tab. */
    id: 'dev-inbox',
    label: 'Dev · Inbox',
    module: 'dev',
    width: 'page',
    render: () => <DevInboxSurface />,
  },
  {
    /* Dev settings (plan #1937.10): the routines that were the Status panel
     * on Home, with Dash's mark under Plan (note 076e7744). */
    id: 'dev-settings',
    label: 'Dev · Settings',
    module: 'dev',
    width: 'page',
    render: () => <DevSettingsSurface />,
  },
  {
    /* Goals settings (plan #1937.10): the morning run on, the weekly run off. */
    id: 'goals-settings',
    label: 'Goals · Settings',
    module: 'goals',
    width: 'page',
    render: () => <GoalsSettingsView settings={{ morningRun: true, weeklyRun: false }} />,
  },
  {
    /* Learn settings (plan #1937.10): goals only on (plan #2164.1), subject
     * offers on, an explain-back card in every ten. */
    id: 'learn-settings',
    label: 'Learn · Settings',
    module: 'learn',
    width: 'page',
    render: () => <LearnSettingsView settings={{ goalsOnly: true, offerSubjects: true, teachBackEvery: 10 }} />,
  },
  {
    /* The runner card on /dev/plan with its four Dashes (plan #1704): a
     * night with two sessions, a goal run and a slot asleep, then off. */
    id: 'dev-runner-crew',
    label: 'Dev · Plan, the runner’s four Dashes',
    module: 'dev',
    width: 'page',
    render: () => <DevRunnerCrewSurface />,
  },
  {
    id: 'dev-specs',
    label: "Dev · Specs",
    module: 'dev',
    width: 'page',
    render: () => <DevSpecsSurface />,
  },
  {
    /* Dash's interview under a workspace's vision (plan #1641): just
     * started, halfway, and drafted with its links. */
    id: 'dev-specs-interview-empty',
    label: 'Dev · Specs, an interview just started',
    module: 'dev',
    width: 'page',
    render: () => <DevSpecsInterviewEmptySurface />,
  },
  {
    id: 'dev-specs-interview-half',
    label: 'Dev · Specs, an interview halfway',
    module: 'dev',
    width: 'page',
    render: () => <DevSpecsInterviewHalfSurface />,
  },
  {
    id: 'dev-specs-interview-drafted',
    label: 'Dev · Specs, an interview drafted',
    module: 'dev',
    width: 'page',
    render: () => <DevSpecsInterviewDraftedSurface />,
  },
  {
    id: 'dev-spec',
    label: "Dev · One spec",
    module: 'dev',
    width: 'page',
    render: () => <DevSpecSurface />,
  },
  {
    id: 'dev-ui-review',
    label: "Dev · UI review",
    module: 'dev',
    width: 'page',
    render: () => <DevUiReviewSurface />,
  },
  {
    id: 'dev-usage',
    label: "Dev · Usage",
    module: 'dev',
    width: 'page',
    render: () => <DevUsageSurface />,
  },
  {
    id: 'dev-usage-empty',
    label: "Dev · Usage, nothing yet",
    module: 'dev',
    width: 'page',
    render: () => <DevUsageEmptySurface />,
  },
  {
    id: 'dev-modules',
    label: "Dev · Modules",
    module: 'dev',
    width: 'page',
    render: () => <DevModulesSurface />,
  },
  {
    id: 'dev-module',
    label: "Dev · Module",
    module: 'dev',
    width: 'page',
    render: () => <DevModuleSurface />,
  },
  {
    id: 'dev-module-ideas',
    label: 'Dev · Module, its ideas',
    module: 'dev',
    width: 'page',
    render: () => <DevModuleIdeasSurface />,
  },

  /* The Goals, Jobs and Mail pages (plan #1601). Fixtures in
   * jobs-page-surfaces.tsx and mail-run-surfaces.tsx. */
  {
    id: 'goals-run',
    label: 'Goals · One run and what it changed',
    module: 'goals',
    width: 'page',
    render: () => <GoalRunSurface />,
  },
  {
    /* One plan run's page (plan #1964.2.4): its facts, its lines and every
     * row it touched as a link. Fixtures in plan-run-surfaces.tsx. */
    id: 'dev-plan-run',
    label: 'Plan · One run and what it touched',
    module: 'dev',
    width: 'page',
    render: () => <PlanRunSurface />,
  },
  {
    /* A run's lines as Dash writes them (plan #1826), on a plan step's run
     * and on a goal run's page: going, waiting on you, gone quiet with its
     * Acknowledge press, just started, and with the live connection lost.
     * Fixtures in run-lines-surfaces.tsx. */
    id: 'run-lines',
    label: 'Runs · Dash’s lines as it works',
    module: 'goals',
    width: 'page',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="run-line"]',
      shows:
        'Dash’s mark in the first card’s header keeps working while a new line, “Kept stale runs open until acknowledged, and committed 7d2e5a1.”, rises into the foot of the list beneath it and the button above goes quiet.',
    },
    render: () => <RunLinesSurface />,
  },
  {
    id: 'jobs-activity',
    label: 'Jobs · Activity',
    module: 'jobs',
    width: 'page',
    render: () => <JobsActivitySurface />,
  },
  {
    id: 'jobs-analytics',
    label: 'Jobs · Analytics',
    module: 'jobs',
    width: 'page',
    render: () => <JobsAnalyticsSurface />,
  },
  {
    id: 'jobs-answers',
    label: 'Jobs · Answers',
    module: 'jobs',
    width: 'page',
    render: () => <JobsAnswersSurface />,
  },
  {
    id: 'jobs-thoughts',
    label: 'Jobs · Settings, the Career goals tab',
    module: 'jobs',
    width: 'page',
    render: () => <JobsSettingsView {...settings} tab="career-goals" opensOn="career-goals" />,
  },
  {
    id: 'jobs-onboarding',
    label: 'Jobs · Onboarding, the first step',
    module: 'jobs',
    width: 'screen',
    render: () => <JobsOnboardingSurface />,
  },
  {
    id: 'jobs-case-page',
    label: 'Jobs · The case page shared with an employer',
    module: 'jobs',
    width: 'screen',
    render: () => <JobsCasePageSurface />,
  },
  {
    id: 'mail-message',
    label: 'Mail · An email read in the app',
    module: 'jobs',
    width: 'page',
    render: () => <MailMessageSurface />,
  },

  /* The Learn pages that had no picture (plan #1602). Fixtures in
   * learn-page-surfaces.tsx. */
  {
    /* Learn's topics (plan #2138.2): drafts first, then the map. */
    id: 'learn-topics',
    label: 'Topics · Name a goal, and the topics you have',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsPreview />,
  },
  {
    id: 'learn-topics-loading',
    label: 'Topics · While a draft is written',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsLoadingPreview />,
  },
  {
    id: 'learn-topics-error',
    label: 'Topics · When drafting fails',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsErrorPreview />,
  },
  {
    /* What a topic is drafted from, open on Edit sources (plan #2138.11). */
    id: 'learn-topics-sources',
    label: 'Topics · The sources a draft is compiled from',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsSourcesPreview />,
  },
  {
    /* A draft topic to read, reword and approve (plan #2138.2). */
    id: 'learn-topic-draft',
    label: 'Topic · A draft to approve',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicDraftPreview />,
  },
  {
    id: 'learn-topic-draft-match',
    label: 'Topic · A draft close to a topic you have',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicDraftMatchPreview />,
  },
  {
    /* The five checks with every row cited or marked personal (plan #2138.11). */
    id: 'learn-topic-draft-checks',
    label: 'Topic · A draft whose checks let it be approved',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicDraftChecksPreview />,
  },
  {
    id: 'learn-topic-draft-comment',
    label: 'Topic · A draft with comments',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicDraftCommentPreview />,
  },
  {
    /* An approved topic: where you stand on each level (plan #2138.3). */
    id: 'learn-topic',
    label: 'Topic · Where you stand on each level',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicPreview />,
  },
  {
    id: 'learn-topic-empty',
    label: 'Topic · Nothing shown yet',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicEmptyPreview />,
  },
  {
    id: 'learn-topic-quotes',
    label: 'Topic · The answers behind a level, open',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicQuotesPreview />,
  },
  {
    id: 'learn-topic-edit',
    label: 'Topic · Rewording a level',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicEditPreview />,
  },
  {
    id: 'learn-topic-loading',
    label: 'Topic · While it loads',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicLoadingPreview />,
  },
  {
    /* Moving the claims graph onto topics (plan #2138.4): what the move
     * left for you, with a failed subject and a downward edge. */
    id: 'learn-topics-review',
    label: 'From the claims graph · What needs your answer',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsReviewPreview />,
  },
  {
    id: 'learn-topics-review-running',
    label: 'From the claims graph · While subjects move',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsReviewRunningPreview />,
  },
  {
    id: 'learn-topics-review-empty',
    label: 'From the claims graph · Before anything has moved',
    module: 'learn',
    width: 'page',
    render: () => <LearnTopicsReviewEmptyPreview />,
  },
  {
    /* A subject or learning goal as a lens (plan #2138.7). */
    id: 'learn-lens',
    label: 'Lens · A subject as topics to targets',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensPreview />,
  },
  {
    id: 'learn-lens-fringe',
    label: 'Lens · What you are ready for on one topic, open',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensFringePreview />,
  },
  {
    id: 'learn-lens-edit',
    label: 'Lens · Setting the targets',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensEditPreview />,
  },
  {
    id: 'learn-lens-untouched',
    label: 'Lens · A goal with no answers yet',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensUntouchedPreview />,
  },
  {
    id: 'learn-lens-empty',
    label: 'Lens · No topics yet',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensEmptyPreview />,
  },
  {
    id: 'learn-lens-loading',
    label: 'Lens · While it loads',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensLoadingPreview />,
  },
  {
    id: 'learn-lens-error',
    label: 'Lens · When it cannot be read',
    module: 'learn',
    width: 'page',
    render: () => <LearnLensErrorPreview />,
  },
  {
    /* The Know page's lenses and fields (plan #2138.7). */
    id: 'learn-know-lenses',
    label: 'Subjects · Lenses, goals and fields by level',
    module: 'learn',
    width: 'page',
    render: () => <LearnKnowLensesPreview />,
  },
  {
    id: 'learn-know-lenses-empty',
    label: 'Subjects · Before anything is on topics',
    module: 'learn',
    width: 'page',
    render: () => <LearnKnowLensesEmptyPreview />,
  },
  {
    id: 'learn-concept',
    label: 'Idea · One idea, partly known',
    module: 'learn',
    width: 'page',
    render: () => <LearnConceptSurface />,
  },
  {
    /* An idea no question has been asked about, backed by a course, a note
     * and your résumé (plan #2006.6): the three listed under where it stands. */
    id: 'learn-concept-evidence',
    label: 'Idea · One idea backed by your notes, courses and work',
    module: 'learn',
    width: 'page',
    render: () => <LearnConceptEvidenceSurface />,
  },
  {
    id: 'learn-lists',
    label: 'Reading lists · Topics and their branches',
    module: 'learn',
    width: 'page',
    render: () => <LearnListsSurface />,
  },
  {
    id: 'learn-opening',
    label: 'Before you start · The opening questions, answered',
    module: 'learn',
    width: 'page',
    render: () => <LearnOpeningSurface />,
  },
  {
    id: 'learn-quiz',
    label: 'Quiz · Part answered',
    module: 'learn',
    width: 'page',
    render: () => <LearnQuizSurface />,
  },
  {
    id: 'learn-quiz-take',
    label: 'Quiz · Answering a question',
    module: 'learn',
    width: 'page',
    render: () => <LearnQuizTakeSurface />,
  },
  {
    /* External check (plan #2179.4): one set scored, one half sat. */
    id: 'learn-external',
    label: 'Learn · External check',
    module: 'learn',
    width: 'page',
    render: () => <LearnExternalSurface />,
  },
  {
    /* No set sat yet: the paste form stands open. */
    id: 'learn-external-new',
    label: 'Learn · External check, no set yet',
    module: 'learn',
    width: 'page',
    render: () => <LearnExternalNewSurface />,
  },
  {
    /* The item form, one question at a time, with nothing said of earlier ones. */
    id: 'learn-external-item',
    label: 'Learn · External check, one item',
    module: 'learn',
    width: 'page',
    render: () => <LearnExternalItemSurface />,
  },
  {
    /* The score, drawn after the last item. */
    id: 'learn-external-score',
    label: 'Learn · External check, the score',
    module: 'learn',
    width: 'page',
    render: () => <LearnExternalScoreSurface />,
  },
  {
    id: 'learn-reading',
    label: 'Reading · One reading, in progress',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingSurface />,
  },
  {
    id: 'learn-reading-text',
    label: 'Reading · Using text you gave it',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingTextSurface />,
  },
  {
    id: 'learn-reading-summary',
    label: 'Reading · With a summary from its link, cut short',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingSummarySurface />,
  },
  {
    id: 'learn-reading-chat',
    label: 'Reading · A chat with Dash about it',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingChatSurface />,
  },
  {
    id: 'learn-reading-unreadable',
    label: 'Reading · Summarize could not read the link',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingUnreadableSurface />,
  },
  {
    id: 'learn-reading-check',
    label: 'Reading · Just marked read, with one question offered',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingCheckSurface />,
  },
  {
    id: 'learn-reading-check-own',
    label: 'Reading · One you added, marked read, nothing offered',
    module: 'learn',
    width: 'page',
    render: () => <LearnReadingCheckOwnSurface />,
  },
  {
    id: 'learn-piece',
    label: 'Plan · One piece, with its practice',
    module: 'learn',
    width: 'page',
    render: () => <LearnPieceSurface />,
  },
  {
    id: 'learn-piece-cell-check',
    label: 'Plan · One piece, its check answered on a cell',
    module: 'learn',
    width: 'page',
    render: () => <LearnPieceCellCheckSurface />,
  },
  {
    id: 'learn-probe',
    label: 'Subject · Questions, before the first',
    module: 'learn',
    width: 'page',
    render: () => <LearnProbeSurface />,
  },
  {
    id: 'learn-videos',
    label: 'Videos · Your list and the library',
    module: 'learn',
    width: 'page',
    render: () => <LearnVideosSurface />,
  },
  {
    id: 'learn-video',
    label: 'Videos · One video on your list',
    module: 'learn',
    width: 'page',
    render: () => <LearnVideoSurface />,
  },
  {
    id: 'learn-youtube-channel',
    label: 'YouTube library · One channel',
    module: 'learn',
    width: 'page',
    render: () => <LearnYoutubeChannelSurface />,
  },
  {
    id: 'learn-youtube-playlist',
    label: 'YouTube library · One playlist',
    module: 'learn',
    width: 'page',
    render: () => <LearnYoutubePlaylistSurface />,
  },
  {
    id: 'learn-youtube-video',
    label: 'YouTube library · One video and its transcript',
    module: 'learn',
    width: 'page',
    render: () => <LearnYoutubeVideoSurface />,
  },

  /* A researched topic on its own page, and Now's list of them (plan
   * #2023.4). Fixtures in brief-surfaces.tsx. */
  {
    id: 'learn-brief',
    label: 'Research brief · Ready, with cited answers',
    module: 'learn',
    width: 'page',
    render: () => <LearnBriefSurface />,
  },
  {
    id: 'learn-brief-new-sources',
    label: 'Research brief · New sources since you asked',
    module: 'learn',
    width: 'page',
    render: () => <LearnBriefNewSourcesSurface />,
  },
  {
    id: 'learn-brief-researching',
    label: 'Research brief · Still researching',
    module: 'learn',
    width: 'page',
    render: () => <LearnBriefResearchingSurface />,
  },
  {
    id: 'learn-brief-failed',
    label: 'Research brief · The run failed',
    module: 'learn',
    width: 'page',
    render: () => <LearnBriefFailedSurface />,
  },
  {
    id: 'learn-brief-quote-source',
    label: 'Research brief · A quote’s source showing',
    module: 'learn',
    width: 'page',
    render: () => <LearnBriefQuoteSourceSurface />,
  },
  {
    id: 'learn-brief-short-answer-editor',
    label: 'Research brief · Editing the short answer',
    module: 'learn',
    width: 'page',
    render: () => <LearnBriefShortAnswerEditorSurface />,
  },
  {
    id: 'learn-now-briefs',
    label: 'Now · Topics you asked Dash to research',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnNowBriefsSurface />,
  },
  /* Essays (plan #1865). Fixtures in essay-surfaces.tsx. */
  {
    id: 'learn-essays',
    label: 'Essays · Drafts and one published',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssaysSurface />,
  },
  {
    id: 'learn-essays-empty',
    label: 'Essays · None yet',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssaysEmptySurface />,
  },
  {
    id: 'learn-essay',
    label: 'Essay · Writing a draft',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssaySurface />,
  },
  {
    id: 'learn-essay-finish',
    label: 'Essay · Finished, with notes and the evidence bank offered',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayFinishSurface />,
  },
  {
    id: 'learn-essay-publish',
    label: 'Essay · Published on the website',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayPublishSurface />,
  },
  {
    id: 'learn-essay-research',
    label: 'Essay · Research on the question and the claims',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayResearchSurface />,
  },
  {
    id: 'learn-essay-study-empty',
    label: 'Essay · Nothing from your study yet',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayStudyEmptySurface />,
  },
  {
    id: 'learn-essay-rephrase',
    label: 'Essay · Rephrase waiting to be accepted',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayRephraseSurface />,
  },
  {
    id: 'learn-essay-notes',
    label: 'Essay · Margin notes from the checks',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayNotesSurface />,
  },
  {
    id: 'learn-essay-marks',
    label: 'Essay · Keep or clear the marks after an edit elsewhere',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayMarksSurface />,
  },
  {
    id: 'learn-essay-changed',
    label: 'Essay · Note changed in Obsidian',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayChangedSurface />,
  },
  {
    id: 'learn-essay-brief',
    label: 'Essay · The brief unfolded',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayBriefSurface />,
  },
  {
    id: 'learn-essay-interview',
    label: 'Essay · A new essay on an empty notes page',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayInterviewSurface />,
  },
  {
    id: 'learn-essay-notes-map',
    label: 'Essay · Notes with Dash’s map beside them',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayNotesMapSurface />,
  },
  {
    id: 'learn-essay-draft-from-notes',
    label: 'Essay · Draft view with Assemble and the model draft',
    module: 'learn',
    width: 'page',
    render: () => <LearnEssayDraftFromNotesSurface />,
  },
  {
    id: 'learn-plan-finished',
    label: 'Subject · A finished plan, ready to write about',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnPlanFinishedSurface />,
  },
  {
    id: 'learn-subject-conversations',
    label: 'Subject · Conversations, each ready to write about',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnSubjectConversationsSurface />,
  },

  /* The News and Todo pages that had no picture (plan #1603). Fixtures in
   * news-todo-page-surfaces.tsx. */
  {
    id: 'news-all',
    label: 'News · Newsletters, newest first',
    module: 'news',
    width: 'page',
    render: () => <NewsAllSurface />,
  },
  {
    id: 'news-story',
    label: 'News · One story on its own page',
    module: 'news',
    width: 'page',
    render: () => <NewsStorySurface />,
  },
  {
    id: 'news-settings',
    label: 'News · Settings',
    module: 'news',
    width: 'page',
    render: () => <NewsSettingsSurface />,
  },
  {
    id: 'todo-all',
    label: 'Todo · All tasks, open',
    module: 'todo',
    width: 'page',
    render: () => <TodoAllSurface />,
  },
  {
    id: 'todo-settings',
    label: 'Todo · Settings',
    module: 'todo',
    width: 'page',
    render: () => <TodoSettingsSurface />,
  },
  {
    id: 'todo-waiting',
    label: 'Todo · Waiting on someone else',
    module: 'todo',
    width: 'page',
    render: () => <TodoWaitingSurface />,
  },

  /* The Shopping pages that had no picture (plan #1604). Fixtures in
   * shopping-page-surfaces.tsx. */
  {
    id: 'shopping-dashboard',
    label: 'Shopping · Dashboard, this month',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingDashboardSurface />,
  },
  {
    id: 'shopping-dashboard-empty',
    label: 'Shopping · Dashboard, no orders yet',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingDashboardEmptySurface />,
  },
  {
    id: 'shopping-order',
    label: 'Shopping · One order',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingOrderSurface />,
  },
  {
    id: 'shopping-returns',
    label: 'Shopping · Returns due soon',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingReturnsSurface />,
  },
  {
    id: 'shopping-saved',
    label: 'Shopping · Saved',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingSavedSurface />,
  },
  {
    id: 'shopping-saved-item',
    label: 'Shopping · One saved item',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingSavedItemSurface />,
  },
  {
    id: 'shopping-settings',
    label: 'Shopping · Settings',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingSettingsSurface />,
  },
  {
    id: 'shopping-shares',
    label: 'Shopping · Shared forms',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingSharesSurface />,
  },
  {
    id: 'shopping-share',
    label: 'Shopping · One shared form',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingShareSurface />,
  },
  {
    id: 'shopping-share-families',
    label: 'Shopping · Grouping',
    module: 'shopping',
    width: 'page',
    render: () => <ShoppingShareFamiliesSurface />,
  },

  /* The Vault pages that had no picture (plan #1605). Fixtures in
   * vault-page-surfaces.tsx. */
  {
    id: 'vault-map',
    label: 'Vault · Map, themes most written about first',
    module: 'vault',
    width: 'page',
    render: () => <VaultMapSurface />,
  },
  {
    id: 'vault-theme',
    label: 'Vault · One theme on the map',
    module: 'vault',
    width: 'page',
    render: () => <VaultThemeSurface />,
  },
  {
    id: 'vault-maya',
    label: 'Vault · Threads with Maya',
    module: 'vault',
    width: 'page',
    render: () => <VaultMayaSurface />,
  },
  {
    id: 'vault-maya-thread',
    label: 'Vault · One thread with Maya',
    module: 'vault',
    width: 'page',
    render: () => <VaultMayaThreadSurface />,
  },
  {
    id: 'vault-settings',
    label: 'Vault · Settings',
    module: 'vault',
    width: 'page',
    render: () => <VaultSettingsSurface />,
  },

  /* The page anatomies, framed at two widths by the anatomy section on
   * /dev/ui. They are registered from one list rather than written out again
   * here, and that list never holds /dev/ui itself -- an anatomy of the page
   * doing the framing would put the gallery inside itself. */
  ...ANATOMIES.map((anatomy) => ({
    id: anatomy.id,
    label: `Anatomy · ${anatomy.label}`,
    module: 'dev' as const,
    width: 'page' as const,
    render: anatomy.render,
  })),

  /* The page patterns (plan #1545), framed by the patterns section on
   * /dev/ui. Registered from the same list for the same reason as the
   * anatomies: a pattern on /dev/ui cannot be without its picture. */
  ...PATTERNS.flatMap((pattern) =>
    pattern.surfaces.map((surface) => ({
      id: surface.id,
      label: `Pattern · ${pattern.label} · ${surface.label}`,
      module: 'dev' as const,
      width: 'page' as const,
      render: surface.render,
      ...(surface.deck ? { deck: surface.deck } : {}),
    })),
  ),
];
