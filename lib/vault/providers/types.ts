/**
 * What the vault sync needs from a source, and nothing more.
 *
 * The interface exists so that "the vault lives in a git repository" is one
 * implementation rather than an assumption threaded through the sync. A local
 * folder, a second forge, an export from somewhere else -- each is a new file
 * in this directory and no change anywhere else.
 *
 * Nothing outside lib/vault/providers/ imports a vendor client, the same rule
 * that keeps lib/email/providers/ swappable, enforced the same way by a lint
 * boundary and asserted in tests/lint-boundaries.test.ts.
 */

import type { AttachmentMimeType } from '@/lib/vault/paths';

/** One markdown file, as the source sees it. */
export type VaultEntry = {
  /** Vault-relative path, '.md' included, no leading slash. */
  path: string;
  /** The source's own content hash. Unchanged hash, unchanged file. */
  blobSha: string;
  sizeBytes: number;
};

/** One image, PDF or audio file, as the source sees it (plan #1300). */
export type VaultAttachmentEntry = {
  /** Repository path, extension included, no leading slash. */
  path: string;
  /** The source's own content hash; also the file's key in storage. */
  blobSha: string;
  sizeBytes: number;
  mimeType: AttachmentMimeType;
  /** Over ATTACHMENT_MAX_BYTES: kept as a row, never copied. */
  tooLarge: boolean;
};

/**
 * What happened to one attachment between two commits. A rename carries the
 * old path, so the row can move without copying the file again. A file renamed
 * into the allowed types arrives as a plain upsert, and one renamed out of them
 * as a delete of its old path.
 */
export type VaultAttachmentChange =
  | ({ kind: 'upsert'; previousPath?: string } & VaultAttachmentEntry)
  | { kind: 'delete'; path: string };

/** What changed between two points in the source's history. */
export type VaultChange =
  | {
      kind: 'upsert';
      path: string;
      blobSha: string;
      sizeBytes: number;
      /** Set when the file arrived at this path by being renamed. */
      previousPath?: string;
    }
  | { kind: 'delete'; path: string };

export type VaultSnapshot = {
  /** Every markdown file at this commit. */
  entries: VaultEntry[];
  /**
   * True when the source could not return the whole tree in one response and
   * the list above is incomplete. Acting on a truncated tree would delete
   * every note it failed to mention, so callers must refuse rather than
   * proceed.
   */
  truncated: boolean;
  /** Every allowed attachment at this commit, too-large ones included. */
  attachments: VaultAttachmentEntry[];
};

export type VaultDiff = {
  changes: VaultChange[];
  /**
   * False when the source could not express the whole diff -- too many files,
   * or a base commit that no longer exists. The caller falls back to a full
   * snapshot comparison, which converges on the same state.
   */
  complete: boolean;
  /**
   * The attachment changes in the same diff, filtered to the allowed types.
   * `changes` above is unfiltered and the planner picks the notes out of it.
   */
  attachments: VaultAttachmentChange[];
  /** When the head commit was made, for dating the notes it touched. */
  headCommittedAt: string | null;
};

export interface VaultSource {
  readonly provider: 'github';

  /** The commit at the tip of the configured branch. */
  headCommit(): Promise<string>;

  /** Every markdown file and allowed attachment at a commit. */
  snapshot(commitSha: string): Promise<VaultSnapshot>;

  /** What changed between two commits. */
  diff(fromCommitSha: string, toCommitSha: string): Promise<VaultDiff>;

  /** A file's text. Only ever called for paths that survived the filter. */
  readBlob(blobSha: string): Promise<string>;

  /** A file's bytes, for copying an attachment into storage. */
  readBlobBytes(blobSha: string): Promise<ArrayBuffer>;
}

/** The source rejected our credentials; the connection needs reconnecting. */
export class VaultAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultAuthError';
  }
}

/** The source is reachable but said no for some other reason. */
export class VaultSourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VaultSourceError';
  }
}
