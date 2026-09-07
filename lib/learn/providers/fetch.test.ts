import { describe, expect, it } from 'vitest';
import { addressIsPublic, fetchDocument } from './fetch';

/**
 * The address guard, and the refusals that happen before any socket opens.
 *
 * These are the cases that matter most in this module and the ones least
 * likely to be exercised by using the app: nobody pastes
 * `https://169.254.169.254/` on purpose. It arrives as a redirect target, or
 * as a hostname somebody controls that resolves inward, and the only place it
 * gets caught is here.
 */

describe('addressIsPublic', () => {
  it('refuses the cloud metadata service', () => {
    // The single most valuable address to reach from a server: on most
    // providers it hands out credentials to anything that asks.
    expect(addressIsPublic('169.254.169.254')).toBe(false);
  });

  it('refuses loopback and the private ranges', () => {
    for (const address of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '0.0.0.0',
      '100.64.0.1',
    ]) {
      expect(addressIsPublic(address), address).toBe(false);
    }
  });

  it('allows the ordinary public internet, including near-misses', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '169.253.0.1']) {
      expect(addressIsPublic(address), address).toBe(true);
    }
  });

  it('refuses the v6 equivalents', () => {
    for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1']) {
      expect(addressIsPublic(address), address).toBe(false);
    }
  });

  it('refuses a v4 private address wearing a v6 mapping', () => {
    // ::ffff:169.254.169.254 reaches the metadata service exactly as the bare
    // form does, and reads as a v6 address to anything that only checks shape.
    expect(addressIsPublic('::ffff:169.254.169.254')).toBe(false);
    expect(addressIsPublic('::ffff:127.0.0.1')).toBe(false);
  });

  it('allows a public v6 address', () => {
    expect(addressIsPublic('2606:4700:4700::1111')).toBe(true);
  });

  it('refuses anything it cannot parse', () => {
    // Fail closed. An address this cannot reason about is not one it connects
    // to.
    expect(addressIsPublic('not-an-address')).toBe(false);
    expect(addressIsPublic('1.2.3')).toBe(false);
    expect(addressIsPublic('999.1.1.1')).toBe(false);
  });
});

describe('fetchDocument refusals', () => {
  it('refuses anything that is not https', async () => {
    // Not a preference. http is where a redirect downgrade lands, and file:
    // and data: read the server itself.
    for (const url of [
      'http://example.org/a',
      'file:///etc/passwd',
      'data:text/html,<p>hi</p>',
      'ftp://example.org/a',
    ]) {
      const result = await fetchDocument(url);
      expect(result.ok, url).toBe(false);
      if (!result.ok) expect(result.reason).toBe('blocked');
    }
  });

  it('refuses a literal private address without resolving anything', async () => {
    const result = await fetchDocument('https://169.254.169.254/latest/meta-data/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('blocked');
      expect(result.detail).toContain('private address');
    }
  });

  it('refuses localhost by name', async () => {
    const result = await fetchDocument('https://localhost:54321/');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked');
  });

  it('refuses a string that is not a URL at all', async () => {
    const result = await fetchDocument('Spheres of Justice, chapter 4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked');
  });
});
