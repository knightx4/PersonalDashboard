import { GAP, none, type ModuleActions } from '@/lib/agent-actions/types';

/** What the News pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const newsActions: ModuleActions = {
  'app/news/actions.ts': {
    setSenderMuted: none('setting'),
  },
  'app/news/all/actions.ts': {
    remakeRecommendations: none('spends'),
  },
  'app/news/i/[id]/actions.ts': {
    markIssueUnread: GAP,
    setStorySaved: GAP,
    sendStoryToLearn: GAP,
    makeTodoFromStory: GAP,
    confirmIssue: none('theirs', 'Says the person confirmed a signup in their mail.'),
  },
  'app/news/quick/actions.ts': {
    passQuickStory: none('own'),
    passQuickPage: none('own'),
    unpassQuickPage: none('own'),
    recordArticleOpened: none('own'),
    reactToQuickStory: none('own'),
    loadStoryDiscussion: none('page'),
    discussQuickStory: none('spends'),
  },
  'app/news/saved/actions.ts': {
    removeSaved: GAP,
  },
  'app/news/settings/actions.ts': {
    replaceAddress: none('account'),
    setTopicShown: none('setting'),
    setLocalArea: none('setting'),
  },
};
