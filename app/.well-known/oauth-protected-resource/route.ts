import { publicEnv } from '@/lib/env';
import { authIssuer } from '@/lib/connector/token';
import { metadataOptionsResponse, protectedResourceResponse } from '@/lib/connector/mcp';

/**
 * Protected resource metadata for /api/mcp (plan #1256, RFC 9728): names
 * Supabase's auth server as where a connector signs in. The 401 from /api/mcp
 * points at the copy under /api/mcp; this bare path is the one clients fall
 * back to. Public in proxy.ts.
 */

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  return protectedResourceResponse(request, authIssuer(publicEnv().NEXT_PUBLIC_SUPABASE_URL));
}

export function OPTIONS(): Response {
  return metadataOptionsResponse();
}
