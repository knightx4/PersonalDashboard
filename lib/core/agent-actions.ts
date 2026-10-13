import { gap, none, type ModuleActions } from '@/lib/agent-actions/types';

/**
 * The actions that belong to no one workspace: signing in, the account, Ask,
 * Home, the timeline, the capture box and the threads (lib/agent-actions/types.ts).
 */
export const coreActions: ModuleActions = {
  'app/(auth)/actions.ts': {
    signIn: none('account'),
    signUp: none('account'),
    signInWithGoogle: none('account'),
    requestPasswordReset: none('account'),
    signOut: none('account'),
  },
  'app/(auth)/oauth/consent/actions.ts': {
    decideConnection: none('account', 'Lets an app in through the connector.'),
  },
  'app/(onboarding)/onboarding/actions.ts': {
    completeOnboarding: none('account'),
    continueToGmailConnect: none('account'),
  },
  'app/account/actions.ts': {
    updateAccountSettings: none('setting'),
    updateEnabledModules: none('setting'),
  },
  'app/account/connected-apps-actions.ts': {
    removeConnectedApp: none('account'),
  },
  'app/account/capture-token-actions.ts': {
    makeCaptureTokenAction: none('account', 'Makes a token another app captures with.'),
    revokeCaptureTokenAction: none('account'),
  },
  'app/account/notification-actions.ts': {
    saveNotificationSubscription: none('account', 'Registers this device for pushes.'),
    removeNotificationSubscription: none('account', 'Unregisters this device.'),
  },
  'app/ask/actions.ts': {
    askDashPageLabel: none('page'),
    recentAskQuestions: none('page'),
    openAskQuestion: none(
      'spends',
      'Asks Dash a question; an agent asking is already the one asking.',
    ),
    pollAskQuestion: none('page'),
    askDashCosts: none('page'),
    confirmDashChange: none('theirs'),
    declineDashChange: none('theirs'),
    undoDashChange: none('theirs'),
  },
  'app/home/actions.ts': {
    openBriefPick: none('page'),
    stopWatch: gap('Stop a price watch Dash is running.'),
    undoDashToday: none('theirs'),
  },
  'app/timeline/actions.ts': {
    markObservationNotUseful: none('theirs'),
    writeYearReview: none('spends'),
  },
  'app/s/[token]/actions.ts': {
    respondToShare: none(
      'outside',
      'Answered by the person a list was shared with, not the account.',
    ),
  },
  'app/theme-actions.ts': {
    setTheme: none('setting'),
  },
  'app/density-actions.ts': {
    setDensity: none('setting'),
  },
  'app/thread-actions.ts': {
    addRowComment: none('theirs'),
    deleteRowComment: none('deletes'),
  },
  'app/capture-actions.ts': {
    sortCaptureBox: none('page'),
    fileCaptureBox: gap('Save a quick thought (plan #1896).'),
    undoCaptureBox: none('theirs'),
    captureBoxCosts: none('page'),
  },
};
