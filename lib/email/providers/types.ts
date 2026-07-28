export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface GmailProfile {
  emailAddress: string;
}

export interface GmailOAuthProvider {
  authorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>;
  fetchProfile(accessToken: string): Promise<GmailProfile>;
  revokeToken(token: string): Promise<void>;
}
