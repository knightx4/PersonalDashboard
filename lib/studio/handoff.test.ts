import { describe, expect, it } from 'vitest';
import { deviceLabel, studioHandoffUrl } from './handoff';

describe('opening the studio from Dash', () => {
  it('puts the settings in the fragment as base64url JSON', () => {
    const url = studioHandoffUrl('https://studio.example/app', {
      url: 'https://abc.supabase.co/',
      key: 'sb_publishable_x',
      token: 'f'.repeat(64),
    });
    const [base, frag] = url.split('#studio=');
    expect(base).toBe('https://studio.example/app');
    expect(frag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(frag, 'base64url').toString('utf8'))).toEqual({
      url: 'https://abc.supabase.co',
      key: 'sb_publishable_x',
      token: 'f'.repeat(64),
    });
  });

  it('names the computer from its browser', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('Safari on Mac');
    expect(deviceLabel(null)).toBe('a browser');
  });
});
