import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/auth/server';

/**
 * OAuth and email-confirmation callback.
 *
 * This handles the *sign-in* grant only. The Gmail read grant has its own
 * callback at /api/auth/gmail/callback, because it is a different OAuth
 * client, a different scope set, and a different consent moment.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/dashboard';

  // Never redirect to an absolute URL supplied in the query string.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/auth/auth-code-error`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
