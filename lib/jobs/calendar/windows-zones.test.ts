import { describe, expect, it } from 'vitest';
import { isKnownZone, toIanaZone } from './windows-zones';

describe('toIanaZone', () => {
  it('translates the Windows names Outlook writes', () => {
    expect(toIanaZone('Eastern Standard Time')).toBe('America/New_York');
    expect(toIanaZone('Pacific Standard Time')).toBe('America/Los_Angeles');
    expect(toIanaZone('GMT Standard Time')).toBe('Europe/London');
    expect(toIanaZone('India Standard Time')).toBe('Asia/Kolkata');
    expect(toIanaZone('AUS Eastern Standard Time')).toBe('Australia/Sydney');
  });

  it('is case- and quote-insensitive, because TZID values are written both ways', () => {
    expect(toIanaZone('"Eastern Standard Time"')).toBe('America/New_York');
    expect(toIanaZone('eastern standard time')).toBe('America/New_York');
    expect(toIanaZone('  Eastern Standard Time  ')).toBe('America/New_York');
  });

  it('passes an IANA name straight through', () => {
    expect(toIanaZone('America/New_York')).toBe('America/New_York');
    expect(toIanaZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(toIanaZone('UTC')).toBe('UTC');
  });

  it('returns null for nothing usable, so the caller can fall back knowingly', () => {
    expect(toIanaZone(null)).toBeNull();
    expect(toIanaZone(undefined)).toBeNull();
    expect(toIanaZone('')).toBeNull();
    expect(toIanaZone('   ')).toBeNull();
    expect(toIanaZone('Mars/Olympus_Mons')).toBeNull();
    expect(toIanaZone('Middle Earth Standard Time')).toBeNull();
  });

  it('yields only names this runtime can actually format with', () => {
    // The whole point of the table is to hand Intl something it accepts; an
    // entry that still throws would reintroduce the bug it exists to fix.
    for (const windows of [
      'Eastern Standard Time',
      'Central Standard Time',
      'Mountain Standard Time',
      'Pacific Standard Time',
      'GMT Standard Time',
      'W Europe Standard Time',
      'India Standard Time',
      'Tokyo Standard Time',
      'China Standard Time',
      'New Zealand Standard Time',
    ]) {
      const zone = toIanaZone(windows);
      expect(zone).not.toBeNull();
      expect(isKnownZone(zone as string)).toBe(true);
    }
  });
});
