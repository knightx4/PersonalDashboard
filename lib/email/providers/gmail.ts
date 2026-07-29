import 'server-only';

import { OAuth2Client } from 'google-auth-library';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { formatGmailApiError } from '@/lib/email/providers/gmail-api-error';
import { emailFromIdToken } from '@/lib/email/id-token';
import { gmailPayloadToText, headerValue } from '@/lib/email/mime';
import {
  GMAIL_READONLY_SCOPE,
  type GmailMessageContent,
  type GmailMessageRef,
  type GmailOAuthProvider,
  type OAuthTokens,
} from '@/lib/email/providers/types';

export { hasGmailReadonlyScope } from '@/lib/email/providers/types';

/** Read-only Gmail + enough identity to learn which address was connected. */
const SCOPES = [GMAIL_READONLY_SCOPE, 'openid', 'email'];

function client(redirectUri?: string): OAuth2Client {
  const { GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET } = gmailOAuthEnv();
  return new OAuth2Client(GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, redirectUri);
}

function toTokens(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
  scope?: string | null;
}): OAuthTokens {
  if (!tokens.access_token) {
    throw new Error('Google did not return an access token');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    idToken: tokens.id_token ?? null,
    scope: tokens.scope ?? null,
  };
}

async function gmailJson<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('gmail api error', { path, status: res.status, body: body.slice(0, 500) });
    throw new Error(formatGmailApiError(res.status, body));
  }
  return res.json() as Promise<T>;
}

export const gmailProvider: GmailOAuthProvider = {
  authorizationUrl(state, redirectUri) {
    return client(redirectUri).generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
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
    const data = await gmailJson<{ emailAddress?: string }>(
      accessToken,
      'users/me/profile',
    );
    if (!data.emailAddress) {
      throw new Error('Gmail profile did not include an email address');
    }
    return { emailAddress: data.emailAddress };
  },

  async revokeToken(token) {
    const oauth = client();
    await oauth.revokeToken(token);
  },

  async refreshAccessToken(refreshToken) {
    const oauth = client();
    oauth.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth.refreshAccessToken();
    return toTokens({
      ...credentials,
      refresh_token: credentials.refresh_token ?? refreshToken,
    });
  },

  async listMessages(accessToken, opts) {
    const params = new URLSearchParams({
      q: opts.query,
      maxResults: String(opts.maxResults ?? 25),
    });
    if (opts.pageToken) params.set('pageToken', opts.pageToken);
    const data = await gmailJson<{
      messages?: GmailMessageRef[];
      nextPageToken?: string;
    }>(accessToken, `users/me/messages?${params}`);
    return {
      messages: data.messages ?? [],
      nextPageToken: data.nextPageToken ?? null,
    };
  },

  async getMessage(accessToken, messageId): Promise<GmailMessageContent> {
    const data = await gmailJson<{
      id: string;
      threadId?: string;
      internalDate?: string;
      payload?: {
        mimeType?: string;
        headers?: Array<{ name?: string; value?: string }>;
        body?: { data?: string };
        parts?: unknown[];
      };
    }>(accessToken, `users/me/messages/${encodeURIComponent(messageId)}?format=full`);

    const headers = data.payload?.headers;
    return {
      id: data.id,
      threadId: data.threadId ?? null,
      internalDate: data.internalDate ? new Date(Number(data.internalDate)) : null,
      fromAddress: headerValue(headers, 'From'),
      subject: headerValue(headers, 'Subject'),
      text: gmailPayloadToText(data.payload as never),
    };
  },
};

/** Resolve the connected address: ID token first, Gmail API as fallback. */
export async function resolveGmailAddress(
  accessToken: string,
  idToken: string | null,
): Promise<string> {
  const fromId = idToken ? emailFromIdToken(idToken) : null;
  if (fromId) return fromId.toLowerCase();

  const profile = await gmailProvider.fetchProfile(accessToken);
  return profile.emailAddress.toLowerCase();
}

export { orderCandidateQuery } from '@/lib/email/providers/gmail-query';
