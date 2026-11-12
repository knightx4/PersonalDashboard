/**
 * Fish Audio voices, as a bot's form lists them (plan #3006.5), filtered and
 * sorted in the picker's pop-up (plan #3081).
 *
 * Fish lists voice models at GET /model: the person's own (cloned) voices
 * with `self=true`, and its public library otherwise, by title, tag and
 * language, ordered by `sort_by`. Each
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
  /** The uploader's tags, as Fish returns them (plan #3081). */
  tags?: string[];
  /** The languages it speaks, as Fish's codes ("en", "zh"). */
  languages?: string[];
  /** How many times it has been used on Fish. */
  uses?: number;
};

/**
 * The voice picker's filters (plan #3081), each a parameter on Fish's
 * GET /model: the title, the gender and style tags (`tag`, repeated), the
 * language, the person's own voices only (`self`), the order (`sort_by`)
 * and the page.
 */
export type VoiceGender = 'any' | 'male' | 'female';
export type VoiceSort = 'task_count' | 'created_at' | 'score';

export type VoiceFilters = {
  search: string;
  gender: VoiceGender;
  /** A Fish language code, or null for any. */
  language: string | null;
  tags: string[];
  mine: boolean;
  sort: VoiceSort;
};

export const DEFAULT_VOICE_FILTERS: VoiceFilters = { search: '', gender: 'any', language: null, tags: [], mine: false, sort: 'task_count' };

/** One page of the picker's results. */
export type VoicePage = { voices: FishVoice[]; total: number; more: boolean };

export const VOICE_SORTS: readonly { value: VoiceSort; label: string }[] = [
  { value: 'task_count', label: 'Most used' },
  { value: 'created_at', label: 'Newest' },
  { value: 'score', label: 'Relevance' },
];

/** The languages offered, English pinned first. */
export const VOICE_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
];

/** The style tags offered as chips, as uploaders on Fish write them. */
export const VOICE_STYLE_TAGS: readonly string[] = ['calm', 'narrator', 'energetic', 'deep', 'young', 'old'];

/** How many voices one page of the picker shows. */
export const VOICE_PAGE = 20;

/** A language code as its name, or the code itself for one not offered. */
export function languageName(code: string): string {
  return VOICE_LANGUAGES.find((l) => l.code === code.toLowerCase())?.label ?? code.toUpperCase();
}

/** "12.3k uses", "1.2m uses", "312 uses", or null for a voice Fish gave no count for. */
export function usesLabel(uses: number | undefined): string | null {
  if (uses === undefined || uses < 0) return null;
  const short = (n: number, unit: string) => `${Number((uses / n).toFixed(uses >= n * 100 ? 0 : 1))}${unit}`;
  const count = uses >= 1e6 ? short(1e6, 'm') : uses >= 1e4 ? short(1e3, 'k') : String(uses).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${count} ${uses === 1 ? 'use' : 'uses'}`;
}

/** Whether any filter is away from its default; Clear filters shows only then. */
export function filtersActive(f: VoiceFilters): boolean {
  return Boolean(f.search.trim()) || f.gender !== 'any' || f.language !== null || f.tags.length > 0 || f.mine || f.sort !== 'task_count';
}

/** A filter set read back from storage or a request, with anything unknown at its default. */
export function filtersOf(raw: unknown): VoiceFilters {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const sorts = VOICE_SORTS.map((s) => s.value) as string[];
  return {
    search: typeof r.search === 'string' ? r.search.slice(0, 80) : '',
    gender: r.gender === 'male' || r.gender === 'female' ? r.gender : 'any',
    language: typeof r.language === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(r.language) ? r.language : null,
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.filter((t): t is string => typeof t === 'string' && /^[\p{L}\p{N} _-]{1,30}$/u.test(t)))].slice(0, 8) : [],
    mine: r.mine === true,
    sort: typeof r.sort === 'string' && sorts.includes(r.sort) ? (r.sort as VoiceSort) : 'task_count',
  };
}

/** Fish's list address for one page of the picker (plan #3081). Arrays go as repeated parameters. */
export function voiceListUrl(base: string, filters: VoiceFilters, page: number, pageSize: number = VOICE_PAGE): string {
  const url = new URL(base);
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('page_number', String(Math.max(1, Math.floor(page))));
  url.searchParams.set('sort_by', filters.sort);
  const title = filters.search.trim().slice(0, 80);
  if (title) url.searchParams.set('title', title);
  if (filters.mine) url.searchParams.set('self', 'true');
  if (filters.language) url.searchParams.set('language', filters.language);
  const tags = [...(filters.gender === 'any' ? [] : [filters.gender]), ...filters.tags];
  for (const tag of tags) url.searchParams.append('tag', tag);
  return url.toString();
}

/** A voice id as Fish writes them, and as the column's check allows: 1 to 64 letters, digits, `_` or `-`. */
export const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The longest voice name kept on the bot's row. */
export const VOICE_NAME_MAX = 120;

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
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim()) : []);
  const tags = strings(row.tags).slice(0, 12);
  const languages = strings(row.languages);
  const uses = typeof row.task_count === 'number' && Number.isFinite(row.task_count) ? row.task_count : undefined;
  return { id, name, author, sample, ...(tags.length ? { tags } : {}), ...(languages.length ? { languages } : {}), ...(uses !== undefined ? { uses } : {}) };
}

/** One page of Fish's list as the picker shows it: its voices, the total, and whether a next page follows. */
export function voicePageOf(body: unknown, page: number, pageSize: number = VOICE_PAGE): VoicePage {
  const voices = voicesOf(body);
  const r = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const total = typeof r.total === 'number' && Number.isFinite(r.total) ? r.total : voices.length;
  const items = Array.isArray(r.items) ? r.items.length : 0;
  const more = typeof r.has_more === 'boolean' ? r.has_more : items >= pageSize && page * pageSize < total;
  return { voices, total, more };
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
