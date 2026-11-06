/**
 * Fish Audio voices, as a bot's form lists them (plan #3006.5).
 *
 * Fish lists voice models at GET /model: the person's own (cloned) voices
 * with `self=true`, and its public library searched by title otherwise. Each
 * model has an id (the `reference_id` a reply is spoken with), a title, an
 * author and, usually, sample recordings whose `audio` is a link the browser
 * can play as it is. Only trained text-to-speech models can speak a reply.
 */

export type FishVoice = {
  id: string;
  name: string;
  /** Who made it on fish.audio; empty for the person's own. */
  author: string;
  /** A recording Fish keeps of it, played as the sample; null when there is none. */
  sample: string | null;
};

export type VoiceList = { mine: FishVoice[]; library: FishVoice[] };

/** A voice id as Fish writes them, and as the column's check allows: 1 to 64 letters, digits, `_` or `-`. */
export const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The longest voice name kept on the bot's row. */
export const VOICE_NAME_MAX = 120;

/** How many library voices a search shows. */
export const LIBRARY_PAGE = 12;

/** The pasted text as a voice id: a bare id, or the id out of a fish.audio link to the voice. */
export function voiceIdOf(pasted: string): string | null {
  const text = pasted.trim();
  if (!text) return null;
  const fromLink = /fish\.audio\/(?:[a-z-]+\/)*m\/([A-Za-z0-9_-]{1,64})/i.exec(text);
  const id = fromLink ? fromLink[1] : text;
  return VOICE_ID.test(id) ? id : null;
}

/** One model from Fish's list as a voice, or null for one that cannot speak a reply. */
export function voiceOf(raw: unknown): FishVoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row._id === 'string' ? row._id : null;
  if (!id || !VOICE_ID.test(id)) return null;
  if (row.type !== undefined && row.type !== 'tts') return null;
  if (row.state !== undefined && row.state !== 'trained') return null;
  const name = typeof row.title === 'string' && row.title.trim() ? row.title.trim().slice(0, VOICE_NAME_MAX) : 'Untitled voice';
  const author =
    row.author && typeof row.author === 'object' && typeof (row.author as Record<string, unknown>).nickname === 'string'
      ? ((row.author as Record<string, unknown>).nickname as string).trim()
      : '';
  const samples = Array.isArray(row.samples) ? row.samples : [];
  const sample =
    samples
      .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>).audio : null))
      .find((a): a is string => typeof a === 'string' && /^https:\/\//.test(a)) ?? null;
  return { id, name, author, sample };
}

/** The voices in one page of Fish's list. */
export function voicesOf(body: unknown): FishVoice[] {
  const items = body && typeof body === 'object' ? (body as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => voiceOf(item) ?? []);
}

/** The line a sample is spoken from when Fish keeps no recording of the voice. */
export function sampleLine(botName: string): string {
  const name = botName.trim() || 'your bot';
  return `Hi, this is ${name}. This is how I sound when I read my replies to you.`;
}
