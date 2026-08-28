/**
 * Whether the job search workspace can connect a Gmail account of its own.
 *
 * Off, deliberately, and not read from the environment.
 *
 * The Gmail credentials in the environment belong to the commerce side. Its
 * OAuth client is registered against a single redirect URI --
 * /api/auth/gmail/callback -- so pointing the job side's connect flow at the
 * same client does not half-work; Google rejects the round trip outright with
 * redirect_uri_mismatch. Reading `isGmailOAuthConfigured()` here would report
 * "configured" on the strength of the other workspace's credentials and offer
 * a button that cannot succeed.
 *
 * Turning this on takes a second OAuth client, with its redirect URI on this
 * deployment's domain, and its id and secret in their own variables. That work
 * is deliberately deferred: the plan is to unify ingestion behind one Gmail
 * grant shared by both workspaces, at which point a second client would have
 * to be un-registered again.
 *
 * Everything behind it is ported and intact -- the sync routes, the linker,
 * the review queue. Only the grant is missing. Roles are added by hand or
 * through the capture bookmarklet in the meantime.
 */
export const JOB_GMAIL_ENABLED = false;
