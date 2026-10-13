import { GAP, none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What Todo's pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const todoActions: ModuleActions = {
  'app/todo/actions.ts': {
    addTask: tool('add_todo'),
    editTask: tool('change_todo', 'edit_todo'),
    renameTaskAction: tool('change_todo'),
    rescheduleTaskAction: tool('change_todo'),
    pointTaskAt: tool('link_todo'),
    unpointTask: none('deletes', 'Takes the link off the todo.'),
    completeTask: tool('close_todo'),
    reopenTask: tool('edit_todo'),
    addItem: tool('add_todo_item'),
    dropTask: tool('edit_todo'),
    pinTask: tool('edit_todo'),
    laterTask: tool('edit_todo'),
    bringBackTask: tool('edit_todo'),
    moveTask: none('setting', 'The order of a pile is how the person arranges their own list.'),
    placeTask: none('setting', 'The order of a pile is how the person arranges their own list.'),
    removeTask: none('deletes'),
    errandAreas: none('page'),
    handTaskToDash: none('spends', 'Hands the task to a Dash routine as an errand.'),
  },
  'app/todo/calendar/actions.ts': {
    addEvent: tool('add_event'),
    editEvent: tool('change_event'),
    removeEvent: none('deletes'),
    toggleCalendar: none('setting'),
  },
  'app/todo/settings/actions.ts': {
    saveAgendaSettingsNow: none('setting'),
    addFeed: none('account', 'Connects a calendar feed from another service.'),
    refreshFeedNow: none('page'),
    removeFeed: none('account'),
  },
  'app/todo/source-actions.ts': {
    completeItem: GAP,
    deferItem: GAP,
    dismissItem: GAP,
    answerItem: none('theirs'),
  },
  'app/todo/link-actions.ts': {
    addLinkedTask: tool('add_todo', 'link_todo'),
    detachTask: none('deletes', 'Takes the link off the todo.'),
  },
};
