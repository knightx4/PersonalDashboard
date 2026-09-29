import 'server-only';

/**
 * The Jev client for app code: lib/jev/wire.ts behind the `server-only`
 * guard. Scripts that run under plain `tsx` import wire.ts directly.
 */
export * from './wire';
