/**
 * Deciding what the sync does with attachments, without doing any of it
 * (plan #1301).
 *
 * The table is reconciled first and the files are copied second, and the two
 * run on different clocks. Rows are cheap, so every run brings them level with
 * the commit it read. Copies are not, so a row starts with no storage_path and
 * the copy phase works through whichever rows still lack one, as far as the
 * run's budget goes. That one rule covers three cases with no bookkeeping of
 * its own: a first sync too large for one run, a copy that failed and must be
 * retried, and a change that arrived in a diff the cursor has since moved past.
 *
 * Copies are keyed by content. A rename moves the row and keeps its copy; a
 * file that appears at a second path reuses the copy the first one has; and an
 * object is removed only when no row points at it any more.
 */
import {
  attachmentMimeType,
  attachmentStoragePath,
  isOverAttachmentLimit,
  toVaultPath,
  type AttachmentMimeType,
} from '@/lib/vault/paths';
import type { VaultAttachmentChange, VaultAttachmentEntry } from '@/lib/vault/providers/types';

/** One attachment row as the database holds it, keyed by vault path. */
export type KnownAttachment = {
  blobSha: string;
  sizeBytes: number;
  mimeType: AttachmentMimeType;
  storagePath: string | null;
};
export type KnownAttachments = ReadonlyMap<string, KnownAttachment>;

export type AttachmentRowWrite = KnownAttachment & { path: string };

/** A file whose bytes still have to be copied into the bucket. */
export type AttachmentCopy = {
  blobSha: string;
  mimeType: AttachmentMimeType;
  sizeBytes: number;
  storagePath: string;
};

export type AttachmentPlan = {
  /** Rows to move to a new path, keeping their id. Applied first. */
  moves: Array<{ from: string; to: string }>;
  /** Rows to delete. Applied after the moves. */
  removes: string[];
  /** Rows to insert or overwrite, by (connection, path). Applied last. */
  upserts: AttachmentRowWrite[];
  /** Objects no row points at once the plan is applied. */
  orphans: string[];
  /** One per distinct file still lacking a copy, in path order. */
  copies: AttachmentCopy[];
  /** Rows kept without a copy because the file is over the size limit. */
  tooLarge: number;
};

/**
 * Applies changes to a working copy of the table, then reads the plan off the
 * difference. Doing it this way means a rename followed by a new file at the
 * old path, or a file that turns up at two paths, needs no special case.
 */
class Reconciler {
  private readonly state: Map<string, KnownAttachment>;
  private readonly moves: Array<{ from: string; to: string }> = [];
  private readonly removed = new Set<string>();
  private readonly written = new Set<string>();
  /** Copies that exist, by blob sha, from the rows as they were loaded. */
  private readonly copiesBySha = new Map<string, string>();

  constructor(
    private readonly known: KnownAttachments,
    private readonly folder: { userId: string; connectionId: string },
  ) {
    this.state = new Map(known);
    for (const row of known.values()) {
      if (row.storagePath) this.copiesBySha.set(row.blobSha, row.storagePath);
    }
  }

  has(path: string): boolean {
    return this.state.has(path);
  }

  paths(): string[] {
    return [...this.state.keys()];
  }

  put(path: string, entry: VaultAttachmentEntry): void {
    const existing = this.state.get(path);
    if (existing && existing.blobSha === entry.blobSha) return;

    const tooLarge = entry.tooLarge || isOverAttachmentLimit(entry.sizeBytes);
    this.state.set(path, {
      blobSha: entry.blobSha,
      sizeBytes: entry.sizeBytes,
      mimeType: entry.mimeType,
      storagePath: tooLarge ? null : (this.copiesBySha.get(entry.blobSha) ?? null),
    });
    this.written.add(path);
    this.removed.delete(path);
  }

  remove(path: string): void {
    if (!this.state.delete(path)) return;
    this.written.delete(path);
    this.removed.add(path);
  }

  move(from: string, to: string, entry: VaultAttachmentEntry): void {
    const row = this.state.get(from);
    if (row && !this.state.has(to) && !this.written.has(from) && !this.removed.has(to)) {
      this.state.delete(from);
      this.state.set(to, row);
      this.moves.push({ from, to });
    } else if (row) {
      this.remove(from);
    }
    // A rename that also changed the file carries a new sha; put() catches it.
    this.put(to, entry);
  }

  plan(): AttachmentPlan {
    const referenced = new Set<string>();
    const copies: AttachmentCopy[] = [];
    const queued = new Set<string>();
    let tooLarge = 0;

    const paths = [...this.state.keys()].sort();
    for (const path of paths) {
      const row = this.state.get(path) as KnownAttachment;
      if (row.storagePath) {
        referenced.add(row.storagePath);
        continue;
      }
      if (isOverAttachmentLimit(row.sizeBytes)) {
        tooLarge += 1;
        continue;
      }
      if (queued.has(row.blobSha)) continue;
      queued.add(row.blobSha);
      copies.push({
        blobSha: row.blobSha,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        storagePath: attachmentStoragePath(this.folder.userId, this.folder.connectionId, row.blobSha),
      });
    }

    const orphans = new Set<string>();
    for (const row of this.known.values()) {
      if (row.storagePath && !referenced.has(row.storagePath)) orphans.add(row.storagePath);
    }

    return {
      moves: this.moves,
      removes: [...this.removed].sort(),
      upserts: [...this.written].sort().map((path) => ({
        path,
        ...(this.state.get(path) as KnownAttachment),
      })),
      orphans: [...orphans].sort(),
      copies,
      tooLarge,
    };
  }
}

/** A repository path as a stored attachment path, or null when it is not one. */
function vaultAttachmentPath(repoPath: string, subpath: string): string | null {
  const path = toVaultPath(repoPath, subpath);
  return path !== null && attachmentMimeType(path) !== null ? path : null;
}

/**
 * The plan from a full listing: every allowed file in the tree gets a row, and
 * every row the tree no longer mentions goes. Only ever called with a complete
 * tree, for the same reason as deletionsFromSnapshot.
 */
export function planAttachmentSnapshot(opts: {
  attachments: VaultAttachmentEntry[];
  known: KnownAttachments;
  subpath: string;
  userId: string;
  connectionId: string;
}): AttachmentPlan {
  const reconciler = new Reconciler(opts.known, opts);
  const present = new Set<string>();

  for (const entry of opts.attachments) {
    const path = vaultAttachmentPath(entry.path, opts.subpath);
    if (path === null) continue;
    present.add(path);
    reconciler.put(path, entry);
  }

  for (const path of reconciler.paths()) {
    if (!present.has(path)) reconciler.remove(path);
  }

  return reconciler.plan();
}

/** The plan from a diff between two commits. */
export function planAttachmentDiff(opts: {
  changes: VaultAttachmentChange[];
  known: KnownAttachments;
  subpath: string;
  userId: string;
  connectionId: string;
}): AttachmentPlan {
  const reconciler = new Reconciler(opts.known, opts);

  for (const change of opts.changes) {
    const path = vaultAttachmentPath(change.path, opts.subpath);

    if (change.kind === 'delete') {
      if (path !== null) reconciler.remove(path);
      continue;
    }

    const previous = change.previousPath
      ? vaultAttachmentPath(change.previousPath, opts.subpath)
      : null;

    if (path === null) {
      // Moved out of the vault's folder: as far as the mirror goes, deleted.
      if (previous !== null) reconciler.remove(previous);
      continue;
    }

    if (previous !== null && previous !== path && reconciler.has(previous)) {
      reconciler.move(previous, path, change);
    } else {
      reconciler.put(path, change);
    }
  }

  return reconciler.plan();
}
