/**
 * Test stub for the `server-only` package.
 *
 * The real module throws when a client bundle imports it, which is what keeps
 * the service-role client and the ATS fetchers off the browser. Vitest runs in
 * neither bundle, so it would throw on every import; this no-op stands in so
 * the pure parts of those modules can be tested. The build still uses the real
 * package, so the boundary it guards is unchanged.
 */
export {};
