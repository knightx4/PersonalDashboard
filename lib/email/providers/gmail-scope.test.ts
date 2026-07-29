import { describe, expect, it } from 'vitest';
import { GMAIL_READONLY_SCOPE, hasGmailReadonlyScope } from '@/lib/email/providers/types';

describe('hasGmailReadonlyScope', () => {
  it('detects gmail.readonly among space-separated scopes', () => {
    expect(
      hasGmailReadonlyScope(`${GMAIL_READONLY_SCOPE} openid email`),
    ).toBe(true);
    expect(hasGmailReadonlyScope('openid email')).toBe(false);
    expect(hasGmailReadonlyScope(null)).toBe(false);
  });
});
