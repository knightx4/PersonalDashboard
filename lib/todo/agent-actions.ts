import { GAP, gap, none, tool, type ModuleActions } from '@/lib/agent-actions/types';

/** What Todo's pages let the person do, and the tool that does each (lib/agent-actions/types.ts). */
export const todoActions: ModuleActions = {
  'app/todo/actions.ts': {
    addTask: tool('add_todo'),
    editTask: gap('change_todo renames and moves; it does not change the notes.'),
    renameTaskAction: tool('change_todo'),
    rescheduleTaskAction: tool('change_todo'),
    pointTaskAt: GAP,
    unpointTask: GAP,
    completeTask: tool('close_todo'),
    reopenTask: GAP,
    addItem: GAP,
    dropTask: GAP,
    pinTask: GAP,
    laterTask: GAP,
    bringBackTask: GAP,
    moveTask: GAP,
    placeTask: GAP,
    removeTask: none('deletes'),
    errandAreas: none('page'),
    handTaskToDash: none('spends', 'Hands the task to a Dash routine as an errand.'),
  },
  'app/todo/calendar/actions.ts': {
    addEvent: GAP,
    editEvent: GAP,
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
    addLinkedTask: GAP,
    detachTask: GAP,
  },
};
