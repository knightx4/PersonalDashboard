/**
 * Which Supabase project the scripts talk to, from the environment alone, so
 * no project is named in the repository.
 *
 * In order: NEXT_PUBLIC_SUPABASE_URL, then SUPABASE_PROJECT_REF, then the
 * `ref` claim inside SUPABASE_SERVICE_ROLE_KEY. A cloud session is often given
 * only the service-role key, and a legacy Supabase key is a JWT that names its
 * project, so that is enough to find it. A key that is not such a JWT (the
 * newer `sb_secret_` kind) needs one of the other two set.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** The project's ref (the subdomain of its API address), or null when nothing says. */
export function supabaseProjectRef(env: Env = process.env): string | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const fromUrl = url ? /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] : undefined;
  // CI builds with a placeholder address, which names no project.
  if (fromUrl && fromUrl !== 'placeholder') return fromUrl;
  if (env.SUPABASE_PROJECT_REF) return env.SUPABASE_PROJECT_REF;
  return refFromKey(env.SUPABASE_SERVICE_ROLE_KEY);
}

/** The project's API address, such as https://abc.supabase.co, or null when nothing says. */
export function supabaseProjectUrl(env: Env = process.env): string | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (url && !url.includes('placeholder')) return url.replace(/\/+$/, '');
  const ref = supabaseProjectRef(env);
  return ref ? `https://${ref}.supabase.co` : null;
}

/** supabaseProjectUrl, or a thrown error that says what to set. */
export function requireSupabaseProjectUrl(env: Env = process.env): string {
  const url = supabaseProjectUrl(env);
  if (!url) {
    throw new Error(
      'No Supabase project is named. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_PROJECT_REF) to the project this app uses.',
    );
  }
  return url;
}

function refFromKey(key: string | undefined): string | null {
  const payload = key?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      ref?: unknown;
    };
    return typeof claims.ref === 'string' && /^[a-z0-9]+$/.test(claims.ref) ? claims.ref : null;
  } catch {
    return null;
  }
}
