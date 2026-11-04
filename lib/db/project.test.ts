import { describe, expect, it } from 'vitest';
import { supabaseProjectRef, supabaseProjectUrl } from './project';

const jwt = (claims: object) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

describe('supabaseProjectUrl', () => {
  it('takes the address it is given', () => {
    expect(supabaseProjectUrl({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc123.supabase.co/' })).toBe(
      'https://abc123.supabase.co',
    );
  });

  it('builds one from a ref, or from the ref inside the service-role key', () => {
    expect(supabaseProjectUrl({ SUPABASE_PROJECT_REF: 'def456' })).toBe(
      'https://def456.supabase.co',
    );
    expect(
      supabaseProjectUrl({
        SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: 'ghi789', role: 'service_role' }),
      }),
    ).toBe('https://ghi789.supabase.co');
  });

  it('says nothing when nothing names a project', () => {
    expect(supabaseProjectUrl({})).toBeNull();
    expect(supabaseProjectUrl({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc' })).toBeNull();
    expect(
      supabaseProjectUrl({ NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co' }),
    ).toBeNull();
  });

  it('reads the ref off an address it is given', () => {
    expect(supabaseProjectRef({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc123.supabase.co' })).toBe(
      'abc123',
    );
  });
});
