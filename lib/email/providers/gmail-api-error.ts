/** Map raw Gmail HTTP failures to short, actionable messages for the UI. */
export function formatGmailApiError(status: number, body: string): string {
  if (
    status === 403 &&
    /Gmail API has not been used|it is disabled|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(
      body,
    )
  ) {
    if (/has not been used|it is disabled/i.test(body)) {
      return 'Gmail API is disabled on the Google Cloud project. Enable gmail.googleapis.com for the OAuth client project, wait a minute, then Import again.';
    }
    return 'Gmail read access was not granted. Disconnect, then Connect Gmail again and leave “See and download your email” checked on Google’s consent screen.';
  }
  return `Gmail API failed (${status}): ${body.replace(/\s+/g, ' ').slice(0, 180)}`;
}
