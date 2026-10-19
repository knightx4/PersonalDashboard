import 'server-only';

import {
  VaultAuthError,
  VaultConflictError,
  VaultReadOnlyError,
  VaultSourceError,
  type VaultAttachmentChange,
  type VaultAttachmentEntry,
  type VaultDiff,
  type VaultChange,
  type VaultSnapshot,
  type VaultSource,
  type VaultWriteResult,
} from '@/lib/vault/providers/types';
import { attachmentMimeType, isNotePath, isOverAttachmentLimit, toRepoPath } from '@/lib/vault/paths';

/**
 * A vault kept in a GitHub repository.
 *
 * Git was chosen over an upload or a cloud-drive scope because it is the only
 * transport that costs the human nothing after the first twenty minutes, and
 * because it hands over incremental sync for free: a commit SHA is a cursor,
 * and blob SHAs are content dedup with no hashing of our own.
 *
 * The one rule that shapes this file: the note and attachment filters run
 * against a *listing*, so no file's bytes are requested here. Attachments are
 * listed with their size and hash only; copying them is the sync's job. That
 * is also why the tarball endpoint is not used despite being one request
 * instead of thousands: it would transfer the entire vault, video and
 * oversized files included, to throw part of it away.
 */

const API = 'https://api.github.com';

export type GithubVaultConfig = {
  owner: string;
  repo: string;
  branch: string;
  /** The vault's folder in the repository; only writes need it (plan #1423). */
  subpath?: string;
  token: string;
};

type ContentsPutResponse = {
  content?: { sha?: string };
  commit?: { sha?: string };
};

type TreeNode = { path?: string; type?: string; sha?: string; size?: number };

type TreeResponse = {
  sha: string;
  truncated?: boolean;
  tree?: TreeNode[];
};

/**
 * How many folders a walk of a truncated tree lists at once, and in all. Four
 * at a time keeps clear of GitHub's secondary rate limit; the ceiling keeps a
 * repository of tens of thousands of folders from spending the hour's quota
 * on one listing, and a walk that would pass it is reported as truncated.
 */
const WALK_CONCURRENCY = 4;
const WALK_FOLDER_LIMIT = 2000;

type CompareResponse = {
  files?: Array<{
    filename?: string;
    previous_filename?: string;
    status?: string;
    sha?: string;
    size?: number;
  }>;
  commits?: Array<{ commit?: { committer?: { date?: string } } }>;
  total_commits?: number;
};

type CommitListResponse = Array<{
  commit?: { author?: { date?: string }; committer?: { date?: string } };
}>;

/** The page number of a Link header's `last` relation, or null when there is none. */
export function lastPage(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="last"/.test(part)) continue;
    const match = /[?&]page=(\d+)/.exec(part);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Compare returns at most 300 files per response. Paginating it is possible,
 * but a diff that large is a vault reorganisation rather than an afternoon's
 * editing, and a full tree comparison is both cheaper and more certain there.
 */
const COMPARE_FILE_LIMIT = 300;

/** An attachment entry for a listed blob, or null when the path is not one. */
function attachmentEntry(path: string, blobSha: string, sizeBytes: number): VaultAttachmentEntry | null {
  const mimeType = attachmentMimeType(path);
  if (!mimeType) return null;
  return { path, blobSha, sizeBytes, mimeType, tooLarge: isOverAttachmentLimit(sizeBytes) };
}

/**
 * The attachment side of one compare entry. A rename between two allowed
 * paths keeps its old path; a rename into the allowed types is a plain
 * upsert, and a rename out of them deletes the old path.
 */
function toAttachmentChange(file: NonNullable<CompareResponse['files']>[number]): VaultAttachmentChange[] {
  const path = file.filename as string;
  const previous = file.previous_filename;

  if (file.status === 'removed') {
    return attachmentMimeType(path) ? [{ kind: 'delete', path }] : [];
  }

  const entry = attachmentEntry(path, file.sha ?? '', file.size ?? 0);
  const previousWasAttachment = previous ? attachmentMimeType(previous) !== null : false;

  if (!entry) {
    return previous && previousWasAttachment ? [{ kind: 'delete', path: previous }] : [];
  }
  return [
    {
      kind: 'upsert',
      ...entry,
      ...(previous && previousWasAttachment ? { previousPath: previous } : {}),
    },
  ];
}

/**
 * How many attachments a vault holds and how much storage they would take,
 * written to the log on every full listing so the first real upload can be
 * judged against the storage quota before it happens.
 */
function logAttachmentTotals(attachments: VaultAttachmentEntry[]): void {
  let bytes = 0;
  let tooLarge = 0;
  for (const a of attachments) {
    if (a.tooLarge) tooLarge += 1;
    else bytes += a.sizeBytes;
  }
  console.info(
    `vault: ${attachments.length} attachments listed, ${bytes} bytes to copy, ${tooLarge} over the size limit`,
  );
}

export class GithubVaultSource implements VaultSource {
  readonly provider = 'github' as const;

  constructor(private readonly config: GithubVaultConfig) {}

  private async request<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
    return (await this.requestWithHeaders<T>(path, accept)).body;
  }

  private async requestWithHeaders<T>(
    path: string,
    accept = 'application/vnd.github+json',
  ): Promise<{ body: T; headers: Headers }> {
    const res = await fetch(`${API}${path}`, {
      headers: {
        accept,
        authorization: `Bearer ${this.config.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'personal-dashboard-vault',
      },
      cache: 'no-store',
    });

    if (res.status === 401 || res.status === 403) {
      // 403 is also GitHub's rate-limit status, and the two need different
      // handling: one wants a new token, the other wants patience. The
      // remaining-quota header is what tells them apart.
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (res.status === 403 && remaining !== '0') {
        throw new VaultSourceError(`GitHub refused ${path} (403)`, 403);
      }
      if (res.status === 403 && remaining === '0') {
        throw new VaultSourceError('GitHub rate limit reached; the sync will resume later', 403);
      }
      throw new VaultAuthError(
        'GitHub rejected the access token. Fine-grained tokens expire — reconnect the vault.',
      );
    }

    if (res.status === 404) {
      throw new VaultSourceError(`GitHub could not find ${path}`, 404);
    }

    if (!res.ok) {
      throw new VaultSourceError(`GitHub ${res.status} for ${path}`, res.status);
    }

    return { body: (await res.json()) as T, headers: res.headers };
  }

  private get base(): string {
    return `/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}`;
  }

  async headCommit(): Promise<string> {
    const commit = await this.request<{ sha?: string }>(
      `${this.base}/commits/${encodeURIComponent(this.config.branch)}`,
    );
    if (!commit.sha) {
      throw new VaultSourceError(`No commit found on branch ${this.config.branch}`);
    }
    return commit.sha;
  }

  /**
   * The commit's whole tree listed one folder at a time (plan #2454.1), for a
   * repository whose recursive listing came back truncated. Each folder is one
   * request, a few at once. The blobs come back with full repository paths,
   * the same shape the recursive listing gives, or null when any folder could
   * not be listed: a request that failed, a folder whose own listing was
   * truncated, or more folders than the walk is allowed to visit. A rejected
   * token and a rate limit still throw, since each has its own message.
   */
  private async walkTree(commitSha: string): Promise<TreeNode[] | null> {
    const blobs: TreeNode[] = [];
    const pending: Array<{ sha: string; prefix: string }> = [{ sha: commitSha, prefix: '' }];
    let listed = 0;
    let complete = true;

    const listOne = async (folder: { sha: string; prefix: string }): Promise<void> => {
      let tree: TreeResponse;
      try {
        tree = await this.request<TreeResponse>(`${this.base}/git/trees/${encodeURIComponent(folder.sha)}`);
      } catch (error) {
        if (error instanceof VaultAuthError) throw error;
        if (error instanceof VaultSourceError && error.status === 403) throw error;
        complete = false;
        return;
      }
      if (tree.truncated) {
        complete = false;
        return;
      }
      for (const node of tree.tree ?? []) {
        if (!node.path || !node.sha) continue;
        const path = folder.prefix ? `${folder.prefix}/${node.path}` : node.path;
        if (node.type === 'blob') blobs.push({ ...node, path });
        else if (node.type === 'tree') pending.push({ sha: node.sha, prefix: path });
      }
    };

    while (pending.length > 0 && complete) {
      if (listed + pending.length > WALK_FOLDER_LIMIT) return null;
      const wave = pending.splice(0, WALK_CONCURRENCY);
      listed += wave.length;
      await Promise.all(wave.map(listOne));
    }

    return complete ? blobs : null;
  }

  async snapshot(commitSha: string): Promise<VaultSnapshot> {
    const tree = await this.request<TreeResponse>(
      `${this.base}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
    );

    // A recursive listing GitHub cut short is completed folder by folder. Only
    // a walk that listed every folder stands in for it; anything less stays
    // truncated, so the sync refuses rather than deleting what it missed.
    let nodes: TreeNode[] = tree.tree ?? [];
    let truncated = Boolean(tree.truncated);
    if (truncated) {
      const walked = await this.walkTree(commitSha);
      if (walked) {
        nodes = walked;
        truncated = false;
      }
    }

    const blobs = nodes.filter((node) => node.type === 'blob' && node.path && node.sha);

    // Notes and attachments come out of the same listing, so knowing what the
    // vault holds costs one request however many files it has. Everything
    // else is dropped here, before any content request exists to be made.
    const entries = blobs
      .filter((node) => isNotePath(node.path as string))
      .map((node) => ({
        path: node.path as string,
        blobSha: node.sha as string,
        sizeBytes: node.size ?? 0,
      }));

    const attachments = blobs.flatMap((node) => {
      const entry = attachmentEntry(node.path as string, node.sha as string, node.size ?? 0);
      return entry ? [entry] : [];
    });

    logAttachmentTotals(attachments);

    // A truncated tree is not a smaller vault, it is an unknown one. Acting on
    // it would delete every note it failed to mention.
    return { entries, truncated, attachments };
  }

  async diff(fromCommitSha: string, toCommitSha: string): Promise<VaultDiff> {
    let response: CompareResponse;
    try {
      response = await this.request<CompareResponse>(
        `${this.base}/compare/${encodeURIComponent(fromCommitSha)}...${encodeURIComponent(toCommitSha)}`,
      );
    } catch (error) {
      // A base commit that no longer exists -- history rewritten, or a force
      // push -- 404s. That is recoverable by rescanning, not a failure, and it
      // is the direct analogue of Gmail's expired historyId catch-up.
      if (error instanceof VaultSourceError && error.status === 404) {
        return { changes: [], complete: false, attachments: [], headCommittedAt: null };
      }
      throw error;
    }

    const files = response.files ?? [];
    if (files.length >= COMPARE_FILE_LIMIT) {
      return { changes: [], complete: false, attachments: [], headCommittedAt: null };
    }

    const changes: VaultChange[] = [];
    const attachments: VaultAttachmentChange[] = [];
    for (const file of files) {
      const path = file.filename;
      if (!path) continue;

      attachments.push(...toAttachmentChange(file));

      if (file.status === 'removed') {
        changes.push({ kind: 'delete', path });
        continue;
      }

      changes.push({
        kind: 'upsert',
        path,
        blobSha: file.sha ?? '',
        sizeBytes: file.size ?? 0,
        ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
      });
    }

    const commits = response.commits ?? [];
    const headCommittedAt = commits[commits.length - 1]?.commit?.committer?.date ?? null;

    return { changes, complete: true, attachments, headCommittedAt };
  }

  /**
   * When the first commit that added `vaultPath` was authored (plan #2413.2).
   *
   * The commits endpoint lists newest first, so a page of one tells how many
   * pages there are through its `last` link, and that page holds the first
   * commit: two requests for a note with history, one for a note with a
   * single commit. GitHub does not follow renames here, so a moved file is
   * dated by the move; the note's other evidence usually reaches further back.
   * A path with no commits on the branch gives null.
   */
  async firstCommitAt(vaultPath: string): Promise<string | null> {
    const repoPath = toRepoPath(vaultPath, this.config.subpath ?? '');
    const query = (page: number) =>
      `${this.base}/commits?sha=${encodeURIComponent(this.config.branch)}` +
      `&path=${encodeURIComponent(repoPath)}&per_page=1&page=${page}`;

    const first = await this.requestWithHeaders<CommitListResponse>(query(1));
    const last = lastPage(first.headers.get('link'));
    const page = last && last > 1 ? await this.request<CommitListResponse>(query(last)) : first.body;
    const commit = page[page.length - 1]?.commit;
    return commit?.author?.date ?? commit?.committer?.date ?? null;
  }

  async readBlob(blobSha: string): Promise<string> {
    return (await this.rawBlob(blobSha, 'a note')).text();
  }

  async readBlobBytes(blobSha: string): Promise<ArrayBuffer> {
    return (await this.rawBlob(blobSha, 'an attachment')).arrayBuffer();
  }

  private async rawBlob(blobSha: string, what: string): Promise<Response> {
    // The raw media type returns the file's bytes rather than a base64 field,
    // and lifts the 1MB ceiling the JSON representation has.
    const res = await fetch(`${API}${this.base}/git/blobs/${encodeURIComponent(blobSha)}`, {
      headers: {
        accept: 'application/vnd.github.raw',
        authorization: `Bearer ${this.config.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'personal-dashboard-vault',
      },
      cache: 'no-store',
    });

    if (res.status === 401) {
      throw new VaultAuthError(`GitHub rejected the access token while reading ${what}.`);
    }
    if (!res.ok) {
      throw new VaultSourceError(`GitHub ${res.status} reading blob ${blobSha}`, res.status);
    }

    return res;
  }

  async writeNote(
    path: string,
    text: string,
    expectedBlobSha: string,
    message: string,
  ): Promise<VaultWriteResult> {
    // The contents API takes the blob SHA the change was based on and refuses
    // the write when the file has moved on, which is the whole of the
    // protection against overwriting an edit made in Obsidian meanwhile.
    return this.putContents(path, text, message, expectedBlobSha);
  }

  async createNote(path: string, text: string, message: string): Promise<VaultWriteResult> {
    // With no blob SHA the contents API only creates: a file already at the
    // path is refused (422), so a note the person has is never overwritten.
    return this.putContents(path, text, message, null);
  }

  async deleteNote(path: string, expectedBlobSha: string, message: string): Promise<string | null> {
    const res = await this.contents('DELETE', path, { message, sha: expectedBlobSha });
    // Gone already, by Obsidian or by hand: there is nothing left to remove.
    if (res.status === 404) return null;
    await this.refused(res, path, 'removed');
    const body = (await res.json()) as ContentsPutResponse;
    return body.commit?.sha ?? null;
  }

  private contents(method: 'PUT' | 'DELETE', path: string, body: Record<string, unknown>): Promise<Response> {
    const repoPath = toRepoPath(path, this.config.subpath ?? '');
    const encodedPath = repoPath.split('/').map(encodeURIComponent).join('/');
    return fetch(`${API}${this.base}/contents/${encodedPath}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'personal-dashboard-vault',
      },
      body: JSON.stringify({ ...body, branch: this.config.branch }),
      cache: 'no-store',
    });
  }

  /** Throws the error a refused contents write means; returns when it went through. */
  private async refused(res: Response, path: string, what: 'saved' | 'created' | 'removed'): Promise<void> {
    const repoPath = toRepoPath(path, this.config.subpath ?? '');
    if (res.status === 409 || res.status === 422) {
      throw new VaultConflictError(
        what === 'created'
          ? `${path} is already in the vault, so a new note was not written over it.`
          : `${path} changed in the vault since it was opened, so it was not ${what}.`,
        path,
      );
    }
    if (res.status === 401) {
      throw new VaultAuthError(
        'GitHub rejected the access token. Fine-grained tokens expire — reconnect the vault.',
      );
    }
    if (res.status === 403) {
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        throw new VaultSourceError('GitHub rate limit reached; try saving again later', 403);
      }
      throw new VaultReadOnlyError(
        'The vault token can read the repository but not write to it. Replace it with one that has Contents: Read and write.',
      );
    }
    if (res.status === 404) {
      throw new VaultSourceError(`GitHub could not find ${repoPath} on ${this.config.branch}`, 404);
    }
    if (!res.ok) {
      throw new VaultSourceError(`GitHub ${res.status} writing ${repoPath}`, res.status);
    }
  }

  private async putContents(
    path: string,
    text: string,
    message: string,
    expectedBlobSha: string | null,
  ): Promise<VaultWriteResult> {
    const res = await this.contents('PUT', path, {
      message,
      content: Buffer.from(text, 'utf8').toString('base64'),
      ...(expectedBlobSha ? { sha: expectedBlobSha } : {}),
    });
    await this.refused(res, path, expectedBlobSha ? 'saved' : 'created');

    const body = (await res.json()) as ContentsPutResponse;
    const blobSha = body.content?.sha;
    const commitSha = body.commit?.sha;
    if (!blobSha || !commitSha) {
      const repoPath = toRepoPath(path, this.config.subpath ?? '');
      throw new VaultSourceError(`GitHub saved ${repoPath} but did not say which commit`);
    }
    return { blobSha, commitSha };
  }

  async canWrite(): Promise<boolean> {
    // Creating a branch needs Contents: Read and write. Pointing it at a commit
    // that cannot exist means a token with write access is refused on the
    // missing commit (422) and a read-only one on permission (403), and no
    // branch is ever made. GitHub checks the permission before the body.
    const res = await fetch(`${API}${this.base}/git/refs`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'personal-dashboard-vault',
      },
      body: JSON.stringify({ ref: 'refs/heads/dash-write-check', sha: '0'.repeat(40) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 422) return true;
    if (res.status === 401) {
      throw new VaultAuthError(
        'GitHub rejected the access token. Fine-grained tokens expire — reconnect the vault.',
      );
    }
    if (res.status === 403) {
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        throw new VaultSourceError('GitHub rate limit reached', 403);
      }
      return false;
    }
    throw new VaultSourceError(`GitHub ${res.status} checking write access`, res.status);
  }
}
