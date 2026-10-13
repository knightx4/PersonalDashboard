import { shellFor } from '@/lib/shell/shell-for';

/**
 * Where a ref opens when its page needs more than the row's id
 * (lib/core/refs.ts). In the account's chrome, the same as /ask: a ref can
 * name a row in any workspace.
 */
export default async function OpenLayout({ children }: { children: React.ReactNode }) {
  return shellFor({ module: null, children });
}
