-- Lock down SECURITY DEFINER helpers.
--
-- These functions exist for triggers (and sync_order_state for rare repair
-- calls from trusted server code). They must not be callable via PostgREST
-- RPC as anon or authenticated -- that is what the security advisor flags.
--
-- EXECUTE is checked when a trigger is *created*, not when it fires, so
-- revoking from anon/authenticated after the fact does not break inserts.

set search_path = public, extensions;

alter function public.touch_updated_at() set search_path = public;

revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_order_state(uuid) from public, anon, authenticated;
revoke all on function public.sync_order_state_from_child() from public, anon, authenticated;
revoke all on function public.sync_order_state_from_inventory() from public, anon, authenticated;
revoke all on function public.sync_order_state_self() from public, anon, authenticated;
