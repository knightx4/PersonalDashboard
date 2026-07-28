/** Decode email from an ID token payload without verifying (TLS + fresh code exchange). */
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
    };
    return typeof json.email === 'string' && json.email.includes('@') ? json.email : null;
  } catch {
    return null;
  }
}
