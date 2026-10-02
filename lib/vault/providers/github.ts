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

type TreeResponse = {
  sha: string;
  truncated?: boolean;
  tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
};

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

    return (await res.json()) as T;
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

  async snapshot(commitSha: string): Promise<VaultSnapshot> {
    const tree = await this.request<TreeResponse>(
      `${this.base}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
    );

    const blobs = (tree.tree ?? []).filter((node) => node.type === 'blob' && node.path && node.sha);

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
    return { entries, truncated: Boolean(tree.truncated), attachments };
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
    const repoPath = toRepoPath(path, this.config.subpath ?? '');
    const encodedPath = repoPath.split('/').map(encodeURIComponent).join('/');

    // The contents API takes the blob SHA the change was based on and refuses
    // the write when the file has moved on, which is the whole of the
    // protection against overwriting an edit made in Obsidian meanwhile.
    const res = await fetch(`${API}${this.base}/contents/${encodedPath}`, {
      method: 'PUT',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.config.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'personal-dashboard-vault',
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(text, 'utf8').toString('base64'),
        sha: expectedBlobSha,
        branch: this.config.branch,
      }),
      cache: 'no-store',
    });

    if (res.status === 409 || res.status === 422) {
      throw new VaultConflictError(
        `${path} changed in the vault since it was opened, so the edit was not saved.`,
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

    const body = (await res.json()) as ContentsPutResponse;
    const blobSha = body.content?.sha;
    const commitSha = body.commit?.sha;
    if (!blobSha || !commitSha) {
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
