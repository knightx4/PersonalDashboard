import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import { ask, readToken, REPO, type Repo } from '@/lib/plan/github';

/**
 * The read-only code lookups a thought-through answer may make (plan
 * #2789.10): a file or a folder of this app's repository on main, and a
 * search of its code, through the GitHub API with GITHUB_READ_TOKEN.
 *
 * Read only by construction: two GET endpoints, the repository fixed to the
 * app's own (REPO), the branch fixed to main. The rows they return are not
 * rows of the person's, so they come back as `found`, which opens nowhere in
 * the app and is never cited.
 */

export const READ_CODE_TOOL = 'read_code';
export const SEARCH_CODE_TOOL = 'search_code';

/** The most of one file the model is sent; a longer file says where it was cut. */
export const MAX_CODE_CHARS = 30_000;
/** The most matches a code search lists. */
export const MAX_CODE_HITS = 20;

export type CodeDeps = {
  token: string | null;
  repo?: Repo;
  fetch?: typeof globalThis.fetch;
};

export function codeDeps(): CodeDeps {
  return { token: readToken() };
}

const NO_TOKEN = 'This deployment has no GITHUB_READ_TOKEN, so the code cannot be read. Answer from the specs and say the code was not read.';

/** A repository path as the model may name one: relative, no "..", no query. */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');
  if (path.length > 300 || /(^|\/)\.\.(\/|$)|[?#\\]/.test(path)) return null;
  return path;
}

type ContentFile = { type: 'file'; path: string; size: number; content?: string; encoding?: string };
type ContentEntry = { type: string; path: string; name: string; size?: number };

/** One file's text, or a folder's entries, from main. */
export async function readCode(input: unknown, deps: CodeDeps): Promise<AskToolResult> {
  if (!deps.token) return { ok: false, error: NO_TOKEN };
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const path = cleanPath(raw.path);
  if (path === null) return { ok: false, error: 'Give the path from the repository root, such as "lib/dash/ask.ts".' };
  const repo = deps.repo ?? REPO;
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  let body: ContentFile | ContentEntry[];
  try {
    body = await ask<ContentFile | ContentEntry[]>(
      `/repos/${repo.owner}/${repo.repo}/contents/${encoded}?ref=${encodeURIComponent(repo.branch)}`,
      deps.token,
      deps.fetch ?? globalThis.fetch,
    );
  } catch (error) {
    const said = error instanceof Error ? error.message : 'GitHub could not be reached.';
    // GitHub answers 404 for a path that is not there as well as for a token without access.
    return { ok: false, error: `${path} could not be read: ${said} Check the path with search_code or by reading its folder.` };
  }
  if (Array.isArray(body)) {
    return {
      ok: true,
      rows: [],
      found: body.map((entry) => ({ path: entry.path, kind: entry.type === 'dir' ? 'folder' : 'file' })),
      note: `${path || 'The repository root'} holds ${body.length} entries. Read a file by its path.`,
    };
  }
  if (body.type !== 'file' || typeof body.content !== 'string') {
    return { ok: false, error: `${path} is not a file or a folder that can be read.` };
  }
  const text = body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content;
  const cut = text.length > MAX_CODE_CHARS;
  return {
    ok: true,
    rows: [],
    found: [{ path: body.path, text: cut ? text.slice(0, MAX_CODE_CHARS) : text }],
    note: cut
      ? `${body.path} is ${text.length} characters; the first ${MAX_CODE_CHARS} are shown. Search for the part you need to find where it is.`
      : `${body.path}, ${text.length} characters, as it is on main.`,
  };
}

type SearchBody = { total_count?: number; items?: { path: string; text_matches?: { fragment?: string }[] }[] };

/** Where words appear in the repository's code. */
export async function searchCode(input: unknown, deps: CodeDeps): Promise<AskToolResult> {
  if (!deps.token) return { ok: false, error: NO_TOKEN };
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const query = typeof raw.query === 'string' ? raw.query.replace(/\s+/g, ' ').trim() : '';
  if (query.length < 2 || query.length > 200) return { ok: false, error: 'Give two to 200 characters to search for.' };
  const repo = deps.repo ?? REPO;
  const q = encodeURIComponent(`${query} repo:${repo.owner}/${repo.repo}`);
  let body: SearchBody;
  try {
    body = await ask<SearchBody>(`/search/code?q=${q}&per_page=${MAX_CODE_HITS}`, deps.token, deps.fetch ?? globalThis.fetch);
  } catch (error) {
    return { ok: false, error: `The code search failed: ${error instanceof Error ? error.message : 'GitHub could not be reached.'}` };
  }
  const items = (body.items ?? []).slice(0, MAX_CODE_HITS);
  const total = typeof body.total_count === 'number' ? body.total_count : items.length;
  return {
    ok: true,
    rows: [],
    found: items.map((item) => ({ path: item.path })),
    note:
      items.length === 0
        ? `Nothing in the code matched "${query}". GitHub searches the default branch, by whole words.`
        : `${total} files matched, showing ${items.length}. Read one with read_code.`,
  };
}

export const READ_CODE_DEFINITION: Anthropic.Tool = {
  name: READ_CODE_TOOL,
  description:
    "Read a file of this app's code as it is on main, or list a folder's files. Give the path from the repository root, such as \"lib/dash/ask.ts\" or \"components/shell\"; an empty path lists the root. Read only. A long file is cut; search_code finds where a word is.",
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The path from the repository root.' } },
    required: ['path'],
    additionalProperties: false,
  },
};

export const SEARCH_CODE_DEFINITION: Anthropic.Tool = {
  name: SEARCH_CODE_TOOL,
  description:
    "Find which files of this app's code hold some words: a function, a table, a phrase from a screen. Returns up to 20 paths; read one with read_code. GitHub matches whole words on main.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The words to find, such as "askDashInRequest".' } },
    required: ['query'],
    additionalProperties: false,
  },
};
