import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getUser } from '@/lib/auth/server';
import { publicEnv } from '@/lib/env';
import { deviceLabel, STUDIO_APP_URL, studioHandoffUrl } from '@/lib/studio/handoff';

/**
 * Open the music studio with this computer connected (lib/studio/handoff.ts).
 * Makes a token for it on your session, which only the app's owner may do,
 * and sends you to the studio with the settings in the address's fragment.
 */
export async function GET(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc('studio_mint_key', {
    device: deviceLabel(request.headers.get('user-agent')),
  });
  if (error || typeof token !== 'string') {
    return new NextResponse(`Could not connect the studio: ${error?.message ?? 'no token came back'}`, {
      status: 403,
    });
  }

  const env = publicEnv();
  const target = studioHandoffUrl(process.env.STUDIO_APP_URL || STUDIO_APP_URL, {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    key: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    token,
  });
  const response = NextResponse.redirect(target);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
