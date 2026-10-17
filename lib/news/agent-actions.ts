import { none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What the News pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const newsActions: ModuleActions = {
  'app/news/actions.ts': {
    setSenderMuted: none('setting'),
  },
  'app/news/all/actions.ts': {
    remakeRecommendations: tool('remake_newsletter_picks'),
  },
  'app/news/i/[id]/actions.ts': {
    markIssueUnread: tool('mark_issue_unread'),
    setStorySaved: tool('save_story'),
    sendStoryToLearn: tool('send_story_to_learn'),
    makeTodoFromStory: tool('make_todo_from_story'),
    confirmIssue: none('theirs', 'Says the person confirmed a signup in their mail.'),
  },
  'app/news/quick/actions.ts': {
    passQuickStory: none('own'),
    passQuickPage: none('own'),
    unpassQuickPage: none('own'),
    recordArticleOpened: none('own'),
    reactToQuickStory: none('own'),
    loadStoryDiscussion: none('page'),
    discussQuickStory: none(
      'spends',
      "Sends the person's own view of a story for Dash's reply in its discussion; an agent asking is already the one asking.",
    ),
  },
  'app/news/saved/actions.ts': {
    removeSaved: tool('save_story'),
  },
  'app/news/settings/actions.ts': {
    replaceAddress: none('account'),
    setTopicShown: none('setting'),
    setLocalArea: none('setting'),
  },
};
