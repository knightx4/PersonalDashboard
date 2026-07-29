export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** True when the grant includes Gmail read-only (granular consent can omit it). */
export function hasGmailReadonlyScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.split(/[\s,]+/).includes(GMAIL_READONLY_SCOPE);
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  /** Present when openid was requested; used to read the account email. */
  idToken: string | null;
  /** Space-separated scopes Google granted (may omit gmail.readonly under granular consent). */
  scope?: string | null;
}

export interface GmailProfile {
  emailAddress: string;
}

export interface GmailMessageRef {
  id: string;
  threadId?: string;
}

export interface GmailMessageContent {
  id: string;
  threadId: string | null;
  internalDate: Date | null;
  fromAddress: string | null;
  subject: string | null;
  text: string;
  /** Ephemeral HTML for product-link extraction; never persisted. */
  html: string;
}

export interface GmailOAuthProvider {
  authorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  fetchProfile(accessToken: string): Promise<GmailProfile>;
  revokeToken(token: string): Promise<void>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
  listMessages(
    accessToken: string,
    opts: { query: string; maxResults?: number; pageToken?: string },
  ): Promise<{ messages: GmailMessageRef[]; nextPageToken: string | null }>;
  getMessage(accessToken: string, messageId: string): Promise<GmailMessageContent>;
}
