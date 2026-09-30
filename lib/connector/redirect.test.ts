import { describe, expect, it } from 'vitest';
import { isAllowedConnectorRedirect, isAllowedConnectorReturn } from '@/lib/connector/redirect';

describe('isAllowedConnectorRedirect', () => {
  it("allows Claude's connector callback", () => {
    expect(isAllowedConnectorRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedConnectorRedirect('https://claude.com/api/mcp/auth_callback')).toBe(true);
  });

  it('refuses an address outside claude.ai', () => {
    expect(isAllowedConnectorRedirect('https://evil.example/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedConnectorRedirect('https://claude.ai.evil.example/api/mcp/auth_callback')).toBe(
      false,
    );
    expect(isAllowedConnectorRedirect('https://evilclaude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedConnectorRedirect('https://www.claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedConnectorRedirect('http://localhost:3000/callback')).toBe(false);
  });

  it('refuses another path on claude.ai', () => {
    expect(isAllowedConnectorRedirect('https://claude.ai/')).toBe(false);
    expect(isAllowedConnectorRedirect('https://claude.ai/api/mcp/auth_callback/x')).toBe(false);
    expect(isAllowedConnectorRedirect('https://claude.ai/api/mcp/auth_callback2')).toBe(false);
  });

  it('refuses plain http, a port, credentials, a query or a fragment', () => {
    expect(isAllowedConnectorRedirect('http://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedConnectorRedirect('https://claude.ai:8443/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedConnectorRedirect('https://a:b@claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isAllowedConnectorRedirect('https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false);
    expect(isAllowedConnectorRedirect('https://claude.ai/api/mcp/auth_callback#x')).toBe(false);
  });

  it('refuses nothing and nonsense', () => {
    expect(isAllowedConnectorRedirect(null)).toBe(false);
    expect(isAllowedConnectorRedirect('')).toBe(false);
    expect(isAllowedConnectorRedirect('not a url')).toBe(false);
    expect(isAllowedConnectorRedirect('javascript:alert(1)')).toBe(false);
  });
});

describe('isAllowedConnectorReturn', () => {
  it('allows the callback with a code or an error and the state', () => {
    expect(
      isAllowedConnectorReturn('https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz'),
    ).toBe(true);
    expect(
      isAllowedConnectorReturn(
        'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=xyz',
      ),
    ).toBe(true);
  });

  it('refuses any other address', () => {
    expect(isAllowedConnectorReturn('https://evil.example/cb?code=abc')).toBe(false);
    expect(isAllowedConnectorReturn('https://claude.ai/other?code=abc')).toBe(false);
    expect(isAllowedConnectorReturn(undefined)).toBe(false);
  });
});
