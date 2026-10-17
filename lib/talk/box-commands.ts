import type { ModuleId } from '@/lib/modules';

/**
 * The commands `/` offers in Dash's box (plan #1899.5): the things Dash can
 * already do with a tool of its own, each written into the box as the
 * opening of a request for the person to finish. Nothing runs on the press;
 * the request is sent like any question and Dash makes the change with the
 * tool named here, which shows under the answer with its Undo.
 *
 * Each one names its workspace, so a command for a workspace that is
 * switched off is not offered. The tool is named so a test can hold each
 * command to a tool Ask's voice really offers.
 */
export type BoxCommand = {
  /** What is typed after the slash, and what the menu shows. */
  name: string;
  /** What it does, in a few words, beside the name. */
  says: string;
  /** What goes into the box in place of `/name`, for the person to finish. */
  opens: string;
  /** The workspace whose tool does it. */
  module: ModuleId;
  /** The write tool Dash calls for it (lib/dash/registry.ts). */
  tool: string;
};

export const BOX_COMMANDS: readonly BoxCommand[] = [
  { name: 'todo', says: 'Add a todo', opens: 'Add a todo: ', module: 'todo', tool: 'add_todo' },
  { name: 'event', says: 'Put something on your calendar', opens: 'Add to my calendar: ', module: 'todo', tool: 'add_event' },
  { name: 'read', says: 'Save to your reading list', opens: 'Save to my reading list: ', module: 'learn', tool: 'add_track_reading' },
  { name: 'learned', says: 'Log what you learned', opens: 'Log what I learned in a quick note: ', module: 'vault', tool: 'add_quick_note' },
  { name: 'note', says: 'Save a quick note to the vault', opens: 'Save a quick note: ', module: 'vault', tool: 'add_quick_note' },
  { name: 'goal', says: 'Add a goal', opens: 'Add a goal: ', module: 'goals', tool: 'add_goal' },
];

/**
 * The commands that match what follows the slash, in their own order, for the
 * workspaces that are on. `typed` is without the slash; empty offers them all.
 */
export function commandsFor(typed: string, enabled?: readonly ModuleId[]): BoxCommand[] {
  const needle = typed.trim().toLowerCase();
  return BOX_COMMANDS.filter(
    (command) =>
      (!enabled || enabled.includes(command.module)) &&
      (command.name.startsWith(needle) || command.says.toLowerCase().includes(needle)),
  );
}

/**
 * What the box's words are asking the menu for at the caret (plan #1899.5):
 * a command while the box holds only `/` and a word, or a row while the caret
 * follows `@` and a few words of a name. Null otherwise. `start` is where
 * the `/` or `@` is, so a choice replaces exactly what was typed for it.
 */
export type BoxTrigger = { kind: 'command' | 'row'; query: string; start: number; end: number };

export function boxTrigger(draft: string, caret: number): BoxTrigger | null {
  const command = /^\/([a-z]*)$/i.exec(draft.slice(0, caret));
  if (command && caret === draft.trimEnd().length) {
    return { kind: 'command', query: command[1], start: 0, end: caret };
  }
  // An @ at the start or after a space, then up to forty characters of a
  // name with no line break: "@acme", "@the catan l".
  const row = /(^|\s)@([^\s@][^\n@]{0,39}|)$/.exec(draft.slice(0, caret));
  if (row) {
    const start = caret - row[2].length - 1;
    return { kind: 'row', query: row[2], start, end: caret };
  }
  return null;
}

/** The draft with what the trigger covered replaced by `text`, and where the caret goes. */
export function replaceTrigger(draft: string, trigger: BoxTrigger, text: string): { draft: string; caret: number } {
  const next = draft.slice(0, trigger.start) + text + draft.slice(trigger.end);
  return { draft: next, caret: trigger.start + text.length };
}
