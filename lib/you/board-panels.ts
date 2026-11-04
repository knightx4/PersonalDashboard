import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * Panels of advisors (plan #2561.12): named groups the person picks in one
 * press when asking the board a question, kept in you.board_panels
 * (migrations-you/0025). `advisors` holds advisor keys, seats and guests
 * alike. Picking a panel on a question writes those keys into the question's
 * own `advisors`, which tells the chair whom to seat
 * (.claude/skills/board/SKILL.md); the question does not remember the panel.
 */

export const PANEL_NAME_MAX = 60;
export const PANEL_SIZE_MAX = 12;
export const NEW_PANEL_NAME = 'New panel';

export type BoardPanel = { id: string; name: string; advisors: string[]; topic: string | null };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function panelOf(row: Record<string, unknown>): BoardPanel | null {
  const name = str(row.name);
  if (!name || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    name,
    advisors: Array.isArray(row.advisors) ? row.advisors.filter((a): a is string => typeof a === 'string') : [],
    topic: str(row.topic) || null,
  };
}

const COLUMNS = 'id, name, advisors, topic';

/** Every panel, oldest first so the seeded four keep their order. */
export async function listPanels(client: YouSupabaseClient, userId: string): Promise<BoardPanel[]> {
  const { data, error } = await client
    .from('board_panels')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const p = panelOf(row as Record<string, unknown>);
    return p ? [p] : [];
  });
}

export async function loadPanel(client: YouSupabaseClient, userId: string, id: string): Promise<BoardPanel | null> {
  const { data, error } = await client
    .from('board_panels')
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? panelOf(data as Record<string, unknown>) : null;
}

export function cleanPanelName(input: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = input.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Give the panel a name.' };
  if (name.length > PANEL_NAME_MAX) return { ok: false, error: `Keep the name to at most ${PANEL_NAME_MAX} characters.` };
  return { ok: true, name };
}

/** Members as the table takes them: each once, each a key on the board, at most twelve. */
export function cleanPanelMembers(
  keys: readonly string[],
  roster: readonly string[],
): { ok: true; advisors: string[] } | { ok: false; error: string } {
  const advisors = [...new Set(keys)];
  if (advisors.some((key) => !roster.includes(key))) return { ok: false, error: 'One of those advisors is not on your board.' };
  if (advisors.length > PANEL_SIZE_MAX) return { ok: false, error: `A panel holds at most ${PANEL_SIZE_MAX} advisors.` };
  return { ok: true, advisors };
}

const UNIQUE_VIOLATION = '23505';
export const NAME_TAKEN = 'You already have a panel with that name.';

/** A new, empty panel. The name is "New panel", numbered when taken, and the person renames it on its page. */
export async function createPanel(client: YouSupabaseClient, userId: string): Promise<BoardPanel> {
  const taken = new Set((await listPanels(client, userId)).map((p) => p.name.toLowerCase()));
  let name: string = NEW_PANEL_NAME;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${NEW_PANEL_NAME} ${n}`;
  const { data, error } = await client
    .from('board_panels')
    .insert({ user_id: userId, name, advisors: [] })
    .select(COLUMNS)
    .single();
  const panel = data ? panelOf(data as Record<string, unknown>) : null;
  if (error || !panel) throw new Error(error?.message ?? 'The panel was not made.');
  return panel;
}

/** Save a name or a member list. Returns false when the panel is not theirs; throws NAME_TAKEN on a clash. */
export async function updatePanel(
  client: YouSupabaseClient,
  userId: string,
  id: string,
  patch: { name?: string; advisors?: string[] },
): Promise<boolean> {
  const { data, error } = await client
    .from('board_panels')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.code === UNIQUE_VIOLATION ? NAME_TAKEN : error.message);
  return (data ?? []).length > 0;
}

export async function removePanel(client: YouSupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await client.from('board_panels').delete().eq('user_id', userId).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * The advisors a panel seats on a question: its members that are on the
 * roster the form offers, in the panel's order. A member who has since been
 * switched off or whose brain is not ready is left out, as the form could not
 * offer them either.
 */
export function panelSeats(panel: BoardPanel, offered: readonly string[]): string[] {
  return panel.advisors.filter((key) => offered.includes(key));
}

/** Whether the picked advisors are exactly what the panel seats. */
export function panelPicked(panel: BoardPanel, picked: readonly string[], offered: readonly string[]): boolean {
  const seats = panelSeats(panel, offered);
  return seats.length > 0 && seats.length === picked.length && seats.every((key) => picked.includes(key));
}

/** The names of a panel's members, in the panel's order; a key no longer on the roster is left out. */
export function panelNames(panel: BoardPanel, roster: readonly { key: string; name: string }[]): string[] {
  return panel.advisors.flatMap((key) => roster.find((a) => a.key === key)?.name ?? []);
}
