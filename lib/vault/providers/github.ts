import 'server-only';

import {
  VaultAuthError,
  VaultSourceError,
  type VaultDiff,
  type VaultChange,
  type VaultSnapshot,
  type VaultSource,
} from '@/lib/vault/providers/types';
import { isNotePath } from '@/lib/vault/paths';

/**
 * A vault kept in a GitHub repository.
 *
 * Git was chosen over an upload or a cloud-drive scope because it is the only
 * transport that costs the human nothing after the first twenty minutes, and
 * because it hands over incremental sync for free: a commit SHA is a cursor,
 * and blob SHAs are content dedup with no hashing of our own.
 *
 * The one rule that shapes this file: the `.md` filter runs against a *listing*,
 * so a photo's bytes are never requested. That is also why the tarball endpoint
 * is not used despite being one request instead of thousands -- it would
 * transfer the entire vault, attachments included, to throw most of it away.
 */

const API = 'https://api.github.com';

export type GithubVaultConfig = {
  owner: string;
  repo: string;
  branch: string;
  token: string;
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

    const entries = (tree.tree ?? [])
      .filter((node) => node.type === 'blob' && node.path && node.sha)
      // The filter that makes "markdown only" real: everything else is dropped
      // here, before any content request exists to be made.
      .filter((node) => isNotePath(node.path as string))
      .map((node) => ({
        path: node.path as string,
        blobSha: node.sha as string,
        sizeBytes: node.size ?? 0,
      }));

    // A truncated tree is not a smaller vault, it is an unknown one. Acting on
    // it would delete every note it failed to mention.
    return { entries, truncated: Boolean(tree.truncated) };
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
        return { changes: [], complete: false, headCommittedAt: null };
      }
      throw error;
    }

    const files = response.files ?? [];
    if (files.length >= COMPARE_FILE_LIMIT) {
      return { changes: [], complete: false, headCommittedAt: null };
    }

    const changes: VaultChange[] = [];
    for (const file of files) {
      const path = file.filename;
      if (!path) continue;

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

    return { changes, complete: true, headCommittedAt };
  }

  async readBlob(blobSha: string): Promise<string> {
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
      throw new VaultAuthError('GitHub rejected the access token while reading a note.');
    }
    if (!res.ok) {
      throw new VaultSourceError(`GitHub ${res.status} reading blob ${blobSha}`, res.status);
    }

    return res.text();
  }
}
