import 'server-only';

import { GithubVaultSource } from '@/lib/vault/providers/github';
import type { VaultSource } from '@/lib/vault/providers/types';

/**
 * The seam.
 *
 * Everything above this line knows there is a vault somewhere; nothing above
 * it knows the vault is in a git repository, let alone whose. Adding a second
 * source is a case here and a file next door -- the same containment that
 * keeps lib/email/providers/ swappable, and for the same reason: the escape
 * hatch is only worth having while it is still cheap to take.
 */
export type VaultConnectionConfig = {
  provider: 'github';
  repoOwner: string;
  repoName: string;
  branch: string;
  /** Decrypted at the call site; never stored or logged in this form. */
  token: string;
};

export function createVaultSource(config: VaultConnectionConfig): VaultSource {
  switch (config.provider) {
    case 'github':
      return new GithubVaultSource({
        owner: config.repoOwner,
        repo: config.repoName,
        branch: config.branch,
        token: config.token,
      });
    default: {
      const unreachable: never = config.provider;
      throw new Error(`Unknown vault provider: ${String(unreachable)}`);
    }
  }
}

export type { VaultSource } from '@/lib/vault/providers/types';
export { VaultAuthError, VaultSourceError } from '@/lib/vault/providers/types';
