import 'server-only';

import { OAuth2Client } from 'google-auth-library';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import {
  GMAIL_READONLY_SCOPE,
  type GmailOAuthProvider,
  type OAuthTokens,
} from '@/lib/email/providers/types';

function client(redirectUri: string): OAuth2Client {
  const { GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET } = gmailOAuthEnv();
  return new OAuth2Client(GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, redirectUri);
}

function toTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}): OAuthTokens {
  if (!tokens.access_token) {
    throw new Error('Google did not return an access token');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
}

export const gmailProvider: GmailOAuthProvider = {
  authorizationUrl(state, redirectUri) {
    return client(redirectUri).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [GMAIL_READONLY_SCOPE],
      state,
      include_granted_scopes: true,
    });
  },

  async exchangeCode(code, redirectUri) {
    const oauth = client(redirectUri);
    const { tokens } = await oauth.getToken(code);
    return toTokens(tokens);
  },

  async fetchProfile(accessToken) {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail profile request failed (${res.status})`);
    }
    const data = (await res.json()) as { emailAddress?: string };
    if (!data.emailAddress) {
      throw new Error('Gmail profile did not include an email address');
    }
    return { emailAddress: data.emailAddress };
  },

  async revokeToken(token) {
    const { GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET } = gmailOAuthEnv();
    const oauth = new OAuth2Client(GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET);
    await oauth.revokeToken(token);
  },
};
