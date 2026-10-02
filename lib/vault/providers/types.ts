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

  /**
   * Commit new text for an existing note on the configured branch (plan #1423).
   *
   * `path` is the vault path as stored in notes.path; the source puts the
   * connection's subpath back in front. `expectedBlobSha` is the blob the
   * editor opened, and the write is refused with VaultConflictError when the
   * file has moved on since, so an edit made elsewhere is never overwritten.
   * A token that can read but not write raises VaultReadOnlyError.
   */
  writeNote(path: string, text: string, expectedBlobSha: string, message: string): Promise<VaultWriteResult>;

  /**
   * Whether the token is allowed to write to the repository (plan #1426), for
   * the line on vault settings. Answered by a write that cannot succeed, so
   * nothing in the repository changes either way. Raises VaultAuthError when
   * the token is rejected outright, and VaultSourceError when GitHub's answer
   * says neither yes nor no.
   */
  canWrite(): Promise<boolean>;
}

/** What a committed note write left behind. */
export type VaultWriteResult = {
  /** The note's new blob SHA, to store so the next sync sees no change. */
  blobSha: string;
  /** The commit the write made on the branch. */
  commitSha: string;
};

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

/**
 * The note changed in the source since the editor opened it: the blob SHA the
 * write was based on is no longer the file's. Nothing was written.
 */
export class VaultConflictError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'VaultConflictError';
  }
}

/**
 * The token reads the vault but is not allowed to write to it. Distinct from
 * VaultAuthError: the connection still syncs, and the fix is a token with
 * write permission rather than a reconnect after expiry.
 */
export class VaultReadOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultReadOnlyError';
  }
}
