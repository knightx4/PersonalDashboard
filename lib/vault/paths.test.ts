import { describe, expect, it } from 'vitest';
import { subpathIsEmail } from '@/lib/vault/paths';

describe('subpathIsEmail', () => {
  it('catches an email a password manager filled into the folder field', () => {
    expect(subpathIsEmail('someone@example.com')).toBe(true);
    expect(subpathIsEmail('/someone@example.com/')).toBe(true);
  });

  it('lets real folders through', () => {
    expect(subpathIsEmail('')).toBe(false);
    expect(subpathIsEmail('notes')).toBe(false);
    expect(subpathIsEmail('vault/notes')).toBe(false);
    expect(subpathIsEmail('people/@mentions')).toBe(false);
  });
});
