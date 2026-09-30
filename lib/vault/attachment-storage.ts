import { VAULT_ATTACHMENTS_BUCKET } from '@/lib/vault/paths';

/**
 * Clearing a folder of the vault-attachments bucket (plan #1303).
 *
 * Rows in obsidian.attachments cascade with the connection and with the
 * account, but the copies in storage do not, so whoever deletes either has to
 * remove the files as well. Copies sit at `<user>/<connection>/<blob sha>`, so
 * one connection's files are the folder `<user>/<connection>` and a whole
 * account's are `<user>`.
 *
 * Only the service role can delete in this bucket, so the client passed in is
 * the service client. The folder is always built from a user id the caller took
 * from the session, never from the request.
 */

/** The part of a storage client this needs, so a test can pass a fake. */
export type AttachmentStorage = {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number },
      ): PromiseLike<{
        data: Array<{ name: string; id: string | null }> | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/** Storage lists and removes at most this many names per call. */
const PAGE = 1000;

/** The folder holding every copy of one connection, or of the whole account. */
export function vaultAttachmentFolder(userId: string, connectionId?: string): string {
  if (!userId) throw new Error('A vault attachment folder needs a user id.');
  return connectionId ? `${userId}/${connectionId}` : userId;
}

/** Every object under a folder, however deep. A folder lists with a null id. */
async function listObjects(
  client: AttachmentStorage,
  folder: string,
  bucketName: string,
): Promise<string[]> {
  const bucket = client.storage.from(bucketName);
  const found: string[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(folder, { limit: PAGE, offset });
    if (error) throw new Error(`Listing attachment copies failed: ${error.message}`);
    const entries = data ?? [];

    for (const entry of entries) {
      const path = `${folder}/${entry.name}`;
      if (entry.id === null) found.push(...(await listObjects(client, path, bucketName)));
      else found.push(path);
    }

    if (entries.length < PAGE) break;
  }

  return found;
}

/**
 * Remove every copy under a folder. Everything is listed before anything is
 * removed, so paging by offset is not thrown off by the removals. Returns the
 * paths it removed. The bucket defaults to vault-attachments; the account
 * deletion also clears vault-transcripts through it (plan #1306).
 */
export async function removeAttachmentFolder(
  client: AttachmentStorage,
  folder: string,
  bucketName: string = VAULT_ATTACHMENTS_BUCKET,
): Promise<string[]> {
  const paths = await listObjects(client, folder, bucketName);
  const bucket = client.storage.from(bucketName);

  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await bucket.remove(paths.slice(i, i + PAGE));
    if (error) throw new Error(`Removing attachment copies failed: ${error.message}`);
  }

  return paths;
}
