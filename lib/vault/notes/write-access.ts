import { VaultAuthError, type VaultSource } from '@/lib/vault/providers/types';

/**
 * What vault settings says about saving edits (plan #1426).
 *
 * - 'yes': the token can write, so a save from a note's page will commit.
 * - 'no': the token reads the vault but cannot write to it.
 * - 'reconnect': there is no usable token, which the connection's own status
 *   already says, so the settings page shows nothing extra for it.
 * - 'unknown': GitHub did not answer either way just now.
 */
export type WriteAccess = 'yes' | 'no' | 'reconnect' | 'unknown';

export async function checkWriteAccess(
  openSource: () => Promise<VaultSource | 'none' | 'reauth'>,
): Promise<WriteAccess> {
  try {
    const source = await openSource();
    if (source === 'none' || source === 'reauth') return 'reconnect';
    return (await source.canWrite()) ? 'yes' : 'no';
  } catch (error) {
    if (error instanceof VaultAuthError) return 'reconnect';
    return 'unknown';
  }
}
