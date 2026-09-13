/**
 * What answering a raise with a yes will do.
 *
 * A raise used to ask for a yes and say nothing about what it caused. The #342
 * raise was answered yes, closed, and nothing happened: the answer went into a
 * thread and no code and no step came out of it. So a raise now names its
 * action when it is filed, in the same shape lib/comments/act.ts already
 * carries out for a comment, and the page shows it under the ask.
 *
 * Named at filing rather than worked out at answering, because #365 runs it
 * with no model call: an action that has to be read out of a sentence is an
 * action somebody has to interpret, and an interpretation is what the #342
 * raise already had.
 *
 * Kept clear of server-only and of the database: one function reads the column,
 * one parses what the CLI was given, and one says it in a sentence.
 */
import { ACTIONS, actionSchema, type DashAction } from '@/lib/comments/reply-payload';
import { MODULES, type ModuleId } from '@/lib/modules';

/**
 * The action, and the sentence the page shows.
 *
 * Both, because they are read in different places: #365 runs `action`, and the
 * page prints `said` under the ask without having to know what any of the
 * names mean.
 */
export type RaiseConsequence = {
  action: DashAction;
  said: string;
};

/** What `--consequence` accepts: a name from the list, then what it works on. */
export const CONSEQUENCE_SHAPE = '<action>: <what it works on>';

/** "File idea", "file-idea", "file_idea" — all the same action. */
function nameOf(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Read one written by the CLI, the way `--consequence "file_idea: …"` gives it.
 *
 * Refused rather than guessed at: a raise whose action cannot be named is a
 * raise that is not ready to be asked, and the name it was given is in the
 * refusal so the session can write it again correctly.
 */
export function parseConsequenceArg(
  raw: string,
  module: ModuleId | null,
): { ok: true; action: DashAction; said: string } | { ok: false; why: string } {
  const input = raw.trim();
  const split = input.indexOf(':');
  const name = nameOf(split === -1 ? input : input.slice(0, split));
  const text = split === -1 ? '' : input.slice(split + 1).trim();

  if (!(ACTIONS as readonly string[]).includes(name)) {
    return {
      ok: false,
      why:
        `"${name || input}" is not an action a yes can take. It is one of ${ACTIONS.join(', ')}, ` +
        `written as "${CONSEQUENCE_SHAPE}".`,
    };
  }
  if (!text) {
    return { ok: false, why: `"${name}" needs what it works on, written as "${CONSEQUENCE_SHAPE}".` };
  }

  const action: DashAction = { name, text, module, field: null };
  return { ok: true, action, said: consequenceSaid(action, module) };
}

/**
 * Read one back off the column.
 *
 * Anything that is not an object with a name reads as no consequence at all,
 * which is what every raise filed before the column existed has.
 */
export function consequenceFrom(raw: unknown, module: ModuleId | null): RaiseConsequence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) return null;

  return { action: parsed.data, said: consequenceSaid(parsed.data, module) };
}

/**
 * The action in one sentence, for the page and for the CLI's own listing.
 *
 * A name outside the list still gets a sentence rather than nothing: the
 * column can hold one, and a raise that shows no consequence reads as a raise
 * that declared none.
 */
export function consequenceSaid(action: DashAction, module: ModuleId | null): string {
  const text = action.text?.trim() ?? '';
  const scope = action.module ?? module;
  const where = scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'the app as a whole';

  switch (action.name) {
    case 'file_idea':
      return `Files this on the ideas page, about ${where}: ${text}`;
    case 'send_step':
      return `Hands ${text} to a session to be built.`;
    case 'reword':
      return `Rewrites ${action.field?.trim() || 'the wording'}: ${text}`;
    default:
      return text ? `${action.name}: ${text}` : action.name;
  }
}
