'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { publicEnv } from '@/lib/env';

/**
 * Auth server actions.
 *
 * Supabase Auth handles identity, verification email, password reset and rate
 * limiting. Google *sign-in* goes through Supabase's built-in provider and is
 * a separate, non-sensitive grant from the Gmail read scope -- do not merge
 * the two consent flows. See docs/SETUP.md.
 */

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
});

/** Only allow same-origin relative paths back from ?next=. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately not distinguishing "no such user" from "wrong password":
    // that difference is an account enumeration oracle.
    return { error: 'That email and password do not match.' };
  }

  revalidatePath('/', 'layout');
  redirect(safeNext(formData.get('next')));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback` },
  });

  if (error) return { error: error.message };

  // The profiles row is created by the on_auth_user_created trigger, not here.
  return { message: 'Check your email to confirm your address, then sign in.' };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const next = safeNext(formData.get('next'));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // openid, email, profile only. The gmail.readonly grant is a separate
      // OAuth client and a separate consent screen, requested later during
      // onboarding -- bundling them shows every new signup an unverified-app
      // warning before they have any reason to trust us.
      redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) redirect('/login?error=oauth');
  redirect(data.url);
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = z.string().email().safeParse(formData.get('email'));
  if (!email.success) return { error: 'Enter a valid email address.' };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/update-password`,
  });

  // Always the same response, whether or not the address exists.
  return { message: 'If that address has an account, a reset link is on its way.' };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
