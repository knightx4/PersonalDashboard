import type { SupabaseClient } from '@supabase/supabase-js';
import { VAULT_SCHEMA } from '@/lib/vault/db/schema-name';
import { DEFAULT_VAULT_RULES, type VaultRules } from './rules';

/**
 * The person's own private-folder rules, read from their vault connection
 * (obsidian.vault_connections, migration 0041 of migrations-vault).
 *
 * Read once per run or request and passed to whyNotRead for every note. Any
 * client works: the read goes through `.schema('obsidian')` and names the
 * user, so a service client reads only this person's row. When there is no
 * connection, or the read fails, the defaults are returned, so a note is
 * never sent because the rules could not be read.
 */
export async function loadVaultRules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  userId: string,
): Promise<VaultRules> {
  try {
    const { data, error } = await client
      .schema(VAULT_SCHEMA)
      .from('vault_connections')
      .select('journal_folders, excluded_folders')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return DEFAULT_VAULT_RULES;
    return rulesFromRow(data as { journal_folders?: unknown; excluded_folders?: unknown });
  } catch {
    return DEFAULT_VAULT_RULES;
  }
}

/** The rules a connection row holds, each list falling back to its default when unreadable. */
export function rulesFromRow(row: { journal_folders?: unknown; excluded_folders?: unknown }): VaultRules {
  return {
    journalFolders: textList(row.journal_folders) ?? DEFAULT_VAULT_RULES.journalFolders,
    excludedFolders: textList(row.excluded_folders) ?? DEFAULT_VAULT_RULES.excludedFolders,
  };
}

function textList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}
