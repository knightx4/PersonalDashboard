import 'server-only';

import { OAuth2Client } from 'google-auth-library';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import {
  formatGmailApiError,
  GMAIL_RATE_LIMIT_RETRIES,
  gmailRetryDelayMs,
  isGmailRateLimit,
} from '@/lib/email/providers/gmail-api-error';
import { emailFromIdToken } from '@/lib/email/id-token';
import {
  gmailPayloadToCalendar,
  gmailPayloadToHtml,
  gmailPayloadToText,
  headerValue,
} from '@/lib/email/mime';
import {
  GmailHistoryExpiredError,
  messageIdsFromHistory,
  type GmailHistoryListResponse,
} from '@/lib/email/providers/gmail-history';
import {
  GMAIL_READONLY_SCOPE,
  type GmailMessageContent,
  type GmailMessageRef,
  type GmailOAuthProvider,
  type OAuthTokens,
} from '@/lib/email/providers/types';

export { hasGmailReadonlyScope } from '@/lib/email/providers/types';
export {
  GmailHistoryExpiredError,
  isGmailHistoryExpiredError,
  messageIdsFromHistory,
} from '@/lib/email/providers/gmail-history';

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

async function gmailJson<T>(
  accessToken: string,
  path: string,
  opts?: { historyNotFound?: boolean },
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) return res.json() as Promise<T>;

    const body = await res.text().catch(() => '');
    // A large import reads faster than Gmail's per-user quota allows. The
    // refusal clears within the minute, so wait it out rather than fail the
    // message: a failed envelope is skipped and the backfill moves past it.
    if (attempt < GMAIL_RATE_LIMIT_RETRIES && isGmailRateLimit(res.status, body)) {
      const waitMs = gmailRetryDelayMs(attempt, res.headers.get('retry-after'));
      console.warn('gmail rate limited, retrying', { path, attempt, waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    console.error('gmail api error', { path, status: res.status, body: body.slice(0, 500) });
    if (opts?.historyNotFound && res.status === 404) {
      throw new GmailHistoryExpiredError();
    }
    throw new Error(formatGmailApiError(res.status, body));
  }
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
    const data = await gmailJson<{ emailAddress?: string; historyId?: string | number }>(
      accessToken,
      'users/me/profile',
    );
    if (!data.emailAddress) {
      throw new Error('Gmail profile did not include an email address');
    }
    return {
      emailAddress: data.emailAddress,
      historyId: data.historyId != null ? String(data.historyId) : null,
    };
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

  async listHistory(accessToken, opts) {
    const params = new URLSearchParams({
      startHistoryId: opts.startHistoryId,
      maxResults: String(opts.maxResults ?? 100),
      // Only message additions — enough for new order confirmations.
      historyTypes: 'messageAdded',
    });
    if (opts.pageToken) params.set('pageToken', opts.pageToken);
    const data = await gmailJson<GmailHistoryListResponse>(
      accessToken,
      `users/me/history?${params}`,
      { historyNotFound: true },
    );
    return {
      messageIds: messageIdsFromHistory(data.history),
      nextPageToken: data.nextPageToken ?? null,
      historyId: data.historyId != null ? String(data.historyId) : null,
    };
  },

  async getMessage(accessToken, messageId, opts): Promise<GmailMessageContent> {
    const format = opts?.format === 'metadata' ? 'metadata' : 'full';
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
    }>(
      accessToken,
      `users/me/messages/${encodeURIComponent(messageId)}?format=${format}`,
    );

    const headers = data.payload?.headers;
    const full = format === 'full';
    return {
      id: data.id,
      threadId: data.threadId ?? null,
      internalDate: data.internalDate ? new Date(Number(data.internalDate)) : null,
      fromAddress: headerValue(headers, 'From'),
      // Reply-To carries the employer far more often than From does, because
      // From is usually the ATS. Capturing it is what makes domain linking work.
      replyToAddress: headerValue(headers, 'Reply-To'),
      subject: headerValue(headers, 'Subject'),
      text: full ? gmailPayloadToText(data.payload as never) : '',
      html: full ? gmailPayloadToHtml(data.payload as never) : '',
      calendar: full ? await collectCalendar(accessToken, data.id, data.payload) : [],
    };
  },

  async getAttachment(accessToken, messageId, attachmentId): Promise<string> {
    const data = await gmailJson<{ data?: string; size?: number }>(
      accessToken,
      `users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!data.data) return '';
    return Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  },
};

/** An invite is a few kilobytes; anything larger is not one. */
const MAX_CALENDAR_ATTACHMENT_BYTES = 512_000;

/**
 * Inline calendar parts, plus the ones Gmail held back behind an attachment id.
 *
 * The extra request only happens for a message that actually carries a large
 * calendar part, which is rare — most invites inline. A failure here costs the
 * invite and nothing else, so it is swallowed rather than failing the message.
 */
async function collectCalendar(
  accessToken: string,
  messageId: string,
  payload: unknown,
): Promise<string[]> {
  const { inline, refs } = gmailPayloadToCalendar(payload as never);
  const bodies = [...inline];

  for (const ref of refs) {
    if (ref.sizeBytes != null && ref.sizeBytes > MAX_CALENDAR_ATTACHMENT_BYTES) continue;
    try {
      const body = await gmailProvider.getAttachment(accessToken, messageId, ref.attachmentId);
      if (body) bodies.push(body);
    } catch (error) {
      console.error('calendar attachment fetch failed', messageId, {
        name: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  return bodies;
}

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
